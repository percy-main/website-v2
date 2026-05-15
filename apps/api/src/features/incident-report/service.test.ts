import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock email package — templates render to empty html, we only assert
// that `send` is called with the right subject / recipient.
vi.mock("@percy-main/email", () => ({
  IncidentReportConfirmation: {
    subject: "We've received your accident / incident report",
    component: vi.fn(),
  },
}));

vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

const {
  mockExecuteTakeFirst,
  mockExecuteTakeFirstOrThrow,
  mockExecute,
  mockQueryBuilder,
} = vi.hoisted(() => {
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();
  const mockExecute = vi.fn();

  const mockQueryBuilder: Record<string, unknown> = {
    selectFrom: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
    execute: mockExecute,
    fn: {
      countAll: vi.fn().mockReturnValue({
        as: vi.fn().mockReturnValue("count_expr"),
      }),
    },
  };

  return {
    mockExecuteTakeFirst,
    mockExecuteTakeFirstOrThrow,
    mockExecute,
    mockQueryBuilder,
  };
});

import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  incidentReportSubmissionSchema,
  type IncidentReportSubmission,
} from "./schemas.ts";
import {
  createIncidentReportSubmission,
  getIncidentReport,
  listIncidentReports,
  updateIncidentReport,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;
const log = createNoopLogger();

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

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockQueryBuilder)) {
    const val = mockQueryBuilder[key];
    if (typeof val === "function" && "mockReturnValue" in (val as object)) {
      (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
    }
  }
});

describe("incidentReportSubmissionSchema", () => {
  it("rejects submissions with declarationConfirmed: false", () => {
    const result = incidentReportSubmissionSchema.safeParse({
      ...validSubmission(),
      declarationConfirmed: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects submissions without declarationConfirmed", () => {
    const { declarationConfirmed: _unused, ...rest } = validSubmission();
    void _unused;
    const result = incidentReportSubmissionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts submissions with declarationConfirmed: true", () => {
    const result = incidentReportSubmissionSchema.safeParse(validSubmission());
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = incidentReportSubmissionSchema.safeParse({
      ...validSubmission(),
      reporterEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown incidentType", () => {
    const result = incidentReportSubmissionSchema.safeParse({
      ...validSubmission(),
      incidentType: "something_else",
    });
    expect(result.success).toBe(false);
  });

  it("requires honeypot to be empty", () => {
    const result = incidentReportSubmissionSchema.safeParse({
      ...validSubmission(),
      website: "http://spam.example.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("createIncidentReportSubmission", () => {
  it("persists the report with all required fields and declaration set", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await createIncidentReportSubmission(db, {
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission(), log);

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
      "accident_incident_report",
    );

    // .values() was called with the insert payload.
    const valuesMock = mockQueryBuilder.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const insertPayload = valuesMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(insertPayload.id).toBe(result.id);
    expect(insertPayload.reporter_name).toBe("Jane Doe");
    expect(insertPayload.reporter_email).toBe("jane@example.com");
    expect(insertPayload.incident_type).toBe("injury");
    expect(insertPayload.declaration_confirmed).toBe(true);
    expect(insertPayload.injury_occurred).toBe(true);
  });

  it("sends a confirmation email to the reporter", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await createIncidentReportSubmission(db, {
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission({ reporterEmail: "reporter@example.com" }), log);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const emailArg = send.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(emailArg.to).toBe("reporter@example.com");
    expect(emailArg.subject).toBe(
      "We've received your accident / incident report",
    );
    expect(typeof emailArg.html).toBe("string");
  });

  it("still sends a confirmation when the reporter prefers no contact", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);

    await createIncidentReportSubmission(db, {
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission({ prefersNoContact: true }), log);

    // Transactional receipt is always sent — see design Q3.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not throw when email delivery fails", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error("SES down"));

    const result = await createIncidentReportSubmission(db, {
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission(), log);

    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("fires a Slack notification when a webhook URL is configured", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await createIncidentReportSubmission(db, {
      slackWebhookUrl: "https://hooks.slack.test/XYZ",
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission(), log);

    // Slack fires fire-and-forget; give the microtask queue a tick.
    await new Promise((r) => setImmediate(r));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://hooks.slack.test/XYZ");
    expect(call[1]?.method).toBe("POST");

    fetchSpy.mockRestore();
  });

  it("skips Slack when no webhook URL is configured", async () => {
    mockExecute.mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await createIncidentReportSubmission(db, {
      baseUrl: "https://percymain.org",
      send,
    })(validSubmission(), log);

    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("short-circuits if the honeypot field is populated", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await createIncidentReportSubmission(db, {
      slackWebhookUrl: "https://hooks.slack.test/XYZ",
      baseUrl: "https://percymain.org",
      send,
    })(
      {
        // Service receives parsed data; we bypass the schema's maxLength to
        // simulate the insert-time guard directly.
        ...validSubmission(),
        website: "http://spam.example.com",
      },
      log,
    );

    // Fake id returned so the bot can't distinguish success from a drop.
    expect(result.id).toBeDefined();
    expect(mockQueryBuilder.insertInto).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe("listIncidentReports", () => {
  it("applies pagination params to limit/offset", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 0 });

    await listIncidentReports(db)({ page: 3, pageSize: 15 });

    expect(mockQueryBuilder.limit).toHaveBeenCalledWith(15);
    expect(mockQueryBuilder.offset).toHaveBeenCalledWith(30);
  });

  it("filters by status when supplied", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 0 });

    await listIncidentReports(db)({
      page: 1,
      pageSize: 20,
      status: "new",
    });

    expect(mockQueryBuilder.where).toHaveBeenCalledWith("status", "=", "new");
  });

  it("does not filter by status when omitted", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 0 });

    await listIncidentReports(db)({ page: 1, pageSize: 20 });

    expect(mockQueryBuilder.where).not.toHaveBeenCalled();
  });

  it("sorts done reports to the bottom and higher severity first among open", async () => {
    mockExecute.mockResolvedValue([
      {
        id: "r-done-high",
        status: "done",
        severity: "high",
        incident_type: "injury",
        reporter_name: "A",
        affected_is_minor: false,
        injury_occurred: false,
        injury_severity: null,
        location: "X",
        occurred_at: new Date("2026-04-01"),
        created_at: new Date("2026-04-01"),
      },
      {
        id: "r-new-low",
        status: "new",
        severity: "low",
        incident_type: "injury",
        reporter_name: "B",
        affected_is_minor: false,
        injury_occurred: false,
        injury_severity: null,
        location: "X",
        occurred_at: new Date("2026-04-02"),
        created_at: new Date("2026-04-02"),
      },
      {
        id: "r-new-high",
        status: "new",
        severity: "high",
        incident_type: "injury",
        reporter_name: "C",
        affected_is_minor: false,
        injury_occurred: false,
        injury_severity: null,
        location: "X",
        occurred_at: new Date("2026-04-03"),
        created_at: new Date("2026-04-03"),
      },
      {
        id: "r-review-unset",
        status: "in_review",
        severity: null,
        incident_type: "injury",
        reporter_name: "D",
        affected_is_minor: false,
        injury_occurred: false,
        injury_severity: null,
        location: "X",
        occurred_at: new Date("2026-04-04"),
        created_at: new Date("2026-04-04"),
      },
    ]);
    mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 4 });

    const result = await listIncidentReports(db)({ page: 1, pageSize: 20 });
    const ids = result.reports.map((r) => r.id);

    expect(ids).toEqual([
      "r-new-high",
      "r-new-low",
      "r-review-unset",
      "r-done-high",
    ]);
  });
});

describe("getIncidentReport", () => {
  it("returns null when no row is found", async () => {
    mockExecuteTakeFirst.mockResolvedValue(undefined);

    const result = await getIncidentReport(db)("missing");
    expect(result).toBeNull();
  });

  it("maps snake_case row to camelCase with joined owner name", async () => {
    mockExecuteTakeFirst.mockResolvedValue({
      id: "r-1",
      reporter_name: "Jane",
      reporter_email: "jane@example.com",
      reporter_phone: null,
      reporter_relationship: "member",
      prefers_no_contact: false,
      affected_name: null,
      affected_relationship: null,
      affected_contact: null,
      affected_is_minor: false,
      occurred_at: new Date("2026-04-24T18:30:00Z"),
      location: "Main pitch",
      activity: null,
      incident_type: "injury",
      description: "Fell over",
      injury_occurred: true,
      nature_of_injury: null,
      body_parts_affected: null,
      injury_severity: "minor",
      first_aid_given: false,
      first_aider_name: null,
      first_aid_details: null,
      medical_treatment_required: false,
      immediate_actions: null,
      witnesses: null,
      declaration_confirmed: true,
      status: "new",
      severity: null,
      owner_user_id: "user-1",
      owner_name: "Admin Alice",
      actions_taken: null,
      target_completion_date: null,
      riddor_required: null,
      riddor_reported_at: null,
      internal_notes: null,
      closure_reason: null,
      closed_at: null,
      safeguarding_discussed: false,
      safeguarding_discussed_at: null,
      safeguarding_notes: null,
      created_at: new Date("2026-04-24T18:31:00Z"),
      updated_at: new Date("2026-04-24T18:31:00Z"),
    });

    const result = await getIncidentReport(db)("r-1");

    expect(result).toMatchObject({
      id: "r-1",
      reporterName: "Jane",
      incidentType: "injury",
      injurySeverity: "minor",
      declarationConfirmed: true,
      ownerUserId: "user-1",
      ownerName: "Admin Alice",
      riddorRequired: null,
      riddorReportedAt: null,
    });
    expect(result?.occurredAt).toBe("2026-04-24T18:30:00.000Z");
  });
});

describe("updateIncidentReport", () => {
  it("only updates the fields provided (plus updated_at)", async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateIncidentReport(db)("r-1", { status: "in_review" });

    const setMock = mockQueryBuilder.set as ReturnType<typeof vi.fn>;
    expect(setMock).toHaveBeenCalledTimes(1);
    const payload = setMock.mock.calls[0][0] as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["status", "updated_at"]);
    expect(payload.status).toBe("in_review");
    expect(typeof payload.updated_at).toBe("string");
  });

  it("distinguishes riddorRequired: null from false", async () => {
    mockExecute.mockResolvedValue(undefined);
    const setMock = mockQueryBuilder.set as ReturnType<typeof vi.fn>;

    await updateIncidentReport(db)("r-1", { riddorRequired: null });
    const nullPayload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(nullPayload).toHaveProperty("riddor_required");
    expect(nullPayload.riddor_required).toBeNull();

    setMock.mockClear();

    await updateIncidentReport(db)("r-1", { riddorRequired: false });
    const falsePayload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(falsePayload.riddor_required).toBe(false);
  });

  it("does not touch riddor_required when the caller omits it", async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateIncidentReport(db)("r-1", { internalNotes: "some note" });

    const setMock = mockQueryBuilder.set as ReturnType<typeof vi.fn>;
    const payload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("riddor_required");
    expect(payload.internal_notes).toBe("some note");
  });

  it("maps camelCase fields to snake_case columns", async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateIncidentReport(db)("r-1", {
      targetCompletionDate: "2026-05-01T00:00:00.000Z",
      safeguardingDiscussed: true,
      safeguardingNotes: "Discussed with SGO",
      closureReason: "No further action",
    });

    const setMock = mockQueryBuilder.set as ReturnType<typeof vi.fn>;
    const payload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.target_completion_date).toBe("2026-05-01T00:00:00.000Z");
    expect(payload.safeguarding_discussed).toBe(true);
    expect(payload.safeguarding_notes).toBe("Discussed with SGO");
    expect(payload.closure_reason).toBe("No further action");
  });

  it("bumps updated_at on every call", async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateIncidentReport(db)("r-1", {});

    const setMock = mockQueryBuilder.set as ReturnType<typeof vi.fn>;
    const payload = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty("updated_at");
  });
});
