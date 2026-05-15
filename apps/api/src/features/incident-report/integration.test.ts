import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import type { IncidentReportSubmission } from "./schemas.ts";
import {
  createIncidentReportSubmission,
  getIncidentReport,
  listIncidentReports,
  updateIncidentReport,
} from "./service.ts";

const log = createNoopLogger();

// Render is React-heavy; stub it out for the integration test. We're not
// testing email rendering here — only the DB round-trip.
vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 60_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

function validSubmission(
  overrides: Partial<IncidentReportSubmission> = {},
): IncidentReportSubmission {
  return {
    reporterName: "Jane Doe",
    reporterEmail: "jane@example.com",
    reporterRelationship: "member",
    prefersNoContact: false,
    affectedIsMinor: false,
    occurredAt: "2026-04-24T18:30:00.000Z",
    location: "Main pitch",
    incidentType: "injury",
    description: "Twisted ankle in fielding practice.",
    injuryOccurred: true,
    firstAidGiven: true,
    medicalTreatmentRequired: false,
    declarationConfirmed: true,
    ...overrides,
  };
}

describe("incident-report (integration)", () => {
  it("persists a full submission through the real schema", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = createIncidentReportSubmission(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      validSubmission({
        reporterName: "Full Submission",
        reporterPhone: "07123456789",
        affectedName: "Junior Player",
        affectedRelationship: "member",
        affectedContact: "parent@example.com",
        affectedIsMinor: true,
        activity: "Junior training",
        natureOfInjury: "Sprained ankle",
        bodyPartsAffected: "Left ankle",
        injurySeverity: "minor",
        firstAiderName: "Coach Smith",
        firstAidDetails: "Ice pack applied",
        immediateActions: "Stopped training, contacted parent",
        witnesses: "Coach Smith, Player B",
      }),
      log,
    );

    const row = await ctx.db
      .selectFrom("accident_incident_report")
      .where("id", "=", id)
      .selectAll()
      .executeTakeFirst();

    expect(row).toBeTruthy();
    expect(row?.reporter_name).toBe("Full Submission");
    expect(row?.reporter_phone).toBe("07123456789");
    expect(row?.reporter_relationship).toBe("member");
    expect(row?.affected_name).toBe("Junior Player");
    expect(row?.affected_relationship).toBe("member");
    expect(row?.affected_contact).toBe("parent@example.com");
    expect(row?.affected_is_minor).toBe(true);
    expect(row?.incident_type).toBe("injury");
    expect(row?.nature_of_injury).toBe("Sprained ankle");
    expect(row?.injury_severity).toBe("minor");
    expect(row?.first_aid_given).toBe(true);
    expect(row?.first_aider_name).toBe("Coach Smith");
    expect(row?.declaration_confirmed).toBe(true);
    expect(row?.status).toBe("new");
    expect(row?.severity).toBeNull();
    expect(row?.riddor_required).toBeNull();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com" }),
    );
  });

  it("accepts a minimal submission with optional fields omitted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = createIncidentReportSubmission(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      {
        reporterName: "Minimal",
        reporterEmail: "minimal@example.com",
        reporterRelationship: "visitor",
        prefersNoContact: false,
        affectedIsMinor: false,
        occurredAt: "2026-04-24T10:00:00.000Z",
        location: "Car park",
        incidentType: "near_miss",
        description: "Almost slipped on wet floor.",
        injuryOccurred: false,
        firstAidGiven: false,
        medicalTreatmentRequired: false,
        declarationConfirmed: true,
      },
      log,
    );

    const row = await ctx.db
      .selectFrom("accident_incident_report")
      .where("id", "=", id)
      .selectAll()
      .executeTakeFirst();

    expect(row).toBeTruthy();
    expect(row?.reporter_phone).toBeNull();
    expect(row?.affected_name).toBeNull();
    expect(row?.activity).toBeNull();
    expect(row?.injury_severity).toBeNull();
    expect(row?.first_aider_name).toBeNull();
    expect(row?.incident_type).toBe("near_miss");
  });

  it("honeypot submission does not insert a row", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = createIncidentReportSubmission(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const before = await ctx.db
      .selectFrom("accident_incident_report")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    const result = await submit(
      {
        ...validSubmission({ reporterEmail: "bot@example.com" }),
        website: "http://spam.example.com",
      },
      log,
    );

    // Fake id so bots can't detect rejection from the response.
    expect(result.id).toBeDefined();
    expect(send).not.toHaveBeenCalled();

    const after = await ctx.db
      .selectFrom("accident_incident_report")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    expect(Number(after.total)).toBe(Number(before.total));
  });

  it("round-trips through list + get + update", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = createIncidentReportSubmission(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      validSubmission({ reporterName: "Round-trip Tester" }),
      log,
    );

    // List finds it (status=new).
    const list = await listIncidentReports(ctx.db)({
      page: 1,
      pageSize: 100,
      status: "new",
    });
    expect(list.reports.some((r) => r.id === id)).toBe(true);

    // Get hydrates camelCase fields.
    const detail = await getIncidentReport(ctx.db)(id);
    expect(detail).not.toBeNull();
    expect(detail?.declarationConfirmed).toBe(true);
    expect(detail?.status).toBe("new");
    expect(detail?.severity).toBeNull();

    // Update sets admin fields without disturbing others.
    await updateIncidentReport(ctx.db)(id, {
      status: "in_review",
      severity: "medium",
      actionsTaken: "Assigned to trustee",
      riddorRequired: false,
      safeguardingDiscussed: true,
      safeguardingNotes: "Reviewed with SGO",
    });

    const updated = await getIncidentReport(ctx.db)(id);
    expect(updated?.status).toBe("in_review");
    expect(updated?.severity).toBe("medium");
    expect(updated?.actionsTaken).toBe("Assigned to trustee");
    expect(updated?.riddorRequired).toBe(false);
    expect(updated?.safeguardingDiscussed).toBe(true);
    expect(updated?.safeguardingNotes).toBe("Reviewed with SGO");

    // Reporter fields untouched.
    expect(updated?.reporterName).toBe("Round-trip Tester");
    expect(updated?.declarationConfirmed).toBe(true);
  });

  it("riddorRequired accepts null, false and true distinctly", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = createIncidentReportSubmission(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(validSubmission(), log);

    await updateIncidentReport(ctx.db)(id, { riddorRequired: true });
    expect((await getIncidentReport(ctx.db)(id))?.riddorRequired).toBe(true);

    await updateIncidentReport(ctx.db)(id, { riddorRequired: false });
    expect((await getIncidentReport(ctx.db)(id))?.riddorRequired).toBe(false);

    await updateIncidentReport(ctx.db)(id, { riddorRequired: null });
    expect((await getIncidentReport(ctx.db)(id))?.riddorRequired).toBeNull();
  });
});
