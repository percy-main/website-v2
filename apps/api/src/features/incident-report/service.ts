import type { DB } from "@percy-main/db";
import { IncidentReportConfirmation, type Email } from "@percy-main/email";
import { render } from "@react-email/render";
import type { Kysely } from "kysely";
import { createElement } from "react";
import type {
  IncidentReportAdminUpdate,
  IncidentReportSubmission,
  ListIncidentReports,
} from "./schemas.ts";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createSlackNotifier(slackWebhookUrl?: string) {
  return async (data: {
    reportId: string;
    reporterName: string;
    location: string;
    occurredAt: string;
    incidentType: string;
    affectedIsMinor: boolean;
    injuryOccurred: boolean;
    injurySeverity: string | null;
    description: string;
    adminUrl: string;
  }) => {
    if (!slackWebhookUrl) return;

    const flags: string[] = [];
    if (data.affectedIsMinor) flags.push("under 18");
    if (data.injuryOccurred) flags.push("injury reported");
    if (data.injurySeverity === "fatal") flags.push("FATAL");
    else if (data.injurySeverity === "serious") flags.push("serious injury");
    const flagText = flags.length > 0 ? ` (${flags.join(", ")})` : "";

    await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `:rotating_light: New accident/incident report${flagText}\n` +
          `*Type:* ${data.incidentType.replace(/_/g, " ")}\n` +
          `*From:* ${data.reporterName}\n` +
          `*When:* ${formatOccurredAt(data.occurredAt)}\n` +
          `*Where:* ${data.location}\n` +
          `*Summary:* ${data.description.slice(0, 500)}${data.description.length > 500 ? "…" : ""}\n` +
          `*Admin:* ${data.adminUrl}`,
      }),
    });
  };
}

export function createIncidentReportSubmission(
  db: Kysely<DB>,
  config: {
    slackWebhookUrl?: string;
    baseUrl: string;
    send: (email: Email) => Promise<void>;
  },
) {
  const sendSlack = createSlackNotifier(config.slackWebhookUrl);
  const imageBaseUrl = `${config.baseUrl}/images`;

  return async (data: IncidentReportSubmission) => {
    // Honeypot tripped — silently accept but don't persist or notify.
    if (data.website && data.website.length > 0) {
      return { id: crypto.randomUUID() };
    }

    const id = crypto.randomUUID();

    await db
      .insertInto("accident_incident_report")
      .values({
        id,
        reporter_name: data.reporterName,
        reporter_email: data.reporterEmail,
        reporter_phone: data.reporterPhone ?? null,
        reporter_relationship: data.reporterRelationship,
        prefers_no_contact: data.prefersNoContact,
        affected_name: data.affectedName ?? null,
        affected_relationship: data.affectedRelationship ?? null,
        affected_contact: data.affectedContact ?? null,
        affected_is_minor: data.affectedIsMinor,
        occurred_at: data.occurredAt,
        location: data.location,
        activity: data.activity ?? null,
        incident_type: data.incidentType,
        description: data.description,
        injury_occurred: data.injuryOccurred,
        nature_of_injury: data.natureOfInjury ?? null,
        body_parts_affected: data.bodyPartsAffected ?? null,
        injury_severity: data.injurySeverity ?? null,
        first_aid_given: data.firstAidGiven,
        first_aider_name: data.firstAiderName ?? null,
        first_aid_details: data.firstAidDetails ?? null,
        medical_treatment_required: data.medicalTreatmentRequired,
        immediate_actions: data.immediateActions ?? null,
        witnesses: data.witnesses ?? null,
        declaration_confirmed: data.declarationConfirmed,
      })
      .execute();

    // Confirmation email — always send as a transactional receipt.
    try {
      await config.send({
        to: data.reporterEmail,
        subject: IncidentReportConfirmation.subject,
        html: await render(
          createElement(IncidentReportConfirmation.component, {
            imageBaseUrl,
            reporterName: data.reporterName,
            occurredAt: formatOccurredAt(data.occurredAt),
            location: data.location,
            reportId: id,
          }),
        ),
      });
    } catch {
      // Don't block submission on email failure.
    }

    // Fire-and-forget Slack notification.
    sendSlack({
      reportId: id,
      reporterName: data.reporterName,
      location: data.location,
      occurredAt: data.occurredAt,
      incidentType: data.incidentType,
      affectedIsMinor: data.affectedIsMinor,
      injuryOccurred: data.injuryOccurred,
      injurySeverity: data.injurySeverity ?? null,
      description: data.description,
      adminUrl: `${config.baseUrl}/admin?tab=incidents`,
    }).catch(() => {
      // Silently ignore Slack failures.
    });

    return { id };
  };
}

export function listIncidentReports(db: Kysely<DB>) {
  return async (params: ListIncidentReports) => {
    const offset = (params.page - 1) * params.pageSize;

    let baseQuery = db.selectFrom("accident_incident_report");
    if (params.status) {
      baseQuery = baseQuery.where("status", "=", params.status);
    }

    const [countResult, rows] = await Promise.all([
      baseQuery
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      baseQuery
        .select([
          "id",
          "status",
          "severity",
          "incident_type",
          "reporter_name",
          "affected_is_minor",
          "injury_occurred",
          "injury_severity",
          "location",
          "occurred_at",
          "created_at",
        ])
        // Open reports first (new, in_review), sorted by recency.
        .orderBy(
          (eb) => eb.case().when("status", "=", "done").then(1).else(0).end(),
          "asc",
        )
        .orderBy("created_at", "desc")
        .limit(params.pageSize)
        .offset(offset)
        .execute(),
    ]);

    const reports = rows
      .map((r) => ({
        id: r.id,
        status: r.status as "new" | "in_review" | "done",
        severity: r.severity as "low" | "medium" | "high" | null,
        incidentType: r.incident_type as
          | "injury"
          | "near_miss"
          | "dangerous_occurrence"
          | "ill_health"
          | "property_damage",
        reporterName: r.reporter_name,
        affectedIsMinor: r.affected_is_minor,
        injuryOccurred: r.injury_occurred,
        injurySeverity: r.injury_severity as
          | "minor"
          | "serious"
          | "fatal"
          | null,
        location: r.location,
        occurredAt: toIsoString(r.occurred_at),
        createdAt: toIsoString(r.created_at),
      }))
      // Secondary sort: within open reports, higher severity first.
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        const aSev = a.severity ? SEVERITY_ORDER[a.severity] : 99;
        const bSev = b.severity ? SEVERITY_ORDER[b.severity] : 99;
        return aSev - bSev;
      });

    return {
      reports,
      total: Number(countResult.total),
      page: params.page,
      pageSize: params.pageSize,
    };
  };
}

function toIsoString(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toIsoStringNullable(v: unknown): string | null {
  return v === null || v === undefined ? null : toIsoString(v);
}

export function getIncidentReport(db: Kysely<DB>) {
  return async (id: string) => {
    const row = await db
      .selectFrom("accident_incident_report")
      .leftJoin("user", "user.id", "accident_incident_report.owner_user_id")
      .where("accident_incident_report.id", "=", id)
      .select([
        "accident_incident_report.id",
        "accident_incident_report.reporter_name",
        "accident_incident_report.reporter_email",
        "accident_incident_report.reporter_phone",
        "accident_incident_report.reporter_relationship",
        "accident_incident_report.prefers_no_contact",
        "accident_incident_report.affected_name",
        "accident_incident_report.affected_relationship",
        "accident_incident_report.affected_contact",
        "accident_incident_report.affected_is_minor",
        "accident_incident_report.occurred_at",
        "accident_incident_report.location",
        "accident_incident_report.activity",
        "accident_incident_report.incident_type",
        "accident_incident_report.description",
        "accident_incident_report.injury_occurred",
        "accident_incident_report.nature_of_injury",
        "accident_incident_report.body_parts_affected",
        "accident_incident_report.injury_severity",
        "accident_incident_report.first_aid_given",
        "accident_incident_report.first_aider_name",
        "accident_incident_report.first_aid_details",
        "accident_incident_report.medical_treatment_required",
        "accident_incident_report.immediate_actions",
        "accident_incident_report.witnesses",
        "accident_incident_report.declaration_confirmed",
        "accident_incident_report.status",
        "accident_incident_report.severity",
        "accident_incident_report.owner_user_id",
        "user.name as owner_name",
        "accident_incident_report.actions_taken",
        "accident_incident_report.target_completion_date",
        "accident_incident_report.riddor_required",
        "accident_incident_report.riddor_reported_at",
        "accident_incident_report.internal_notes",
        "accident_incident_report.closure_reason",
        "accident_incident_report.closed_at",
        "accident_incident_report.safeguarding_discussed",
        "accident_incident_report.safeguarding_discussed_at",
        "accident_incident_report.safeguarding_notes",
        "accident_incident_report.created_at",
        "accident_incident_report.updated_at",
      ])
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      reporterName: row.reporter_name,
      reporterEmail: row.reporter_email,
      reporterPhone: row.reporter_phone,
      reporterRelationship: row.reporter_relationship,
      prefersNoContact: row.prefers_no_contact,
      affectedName: row.affected_name,
      affectedRelationship: row.affected_relationship,
      affectedContact: row.affected_contact,
      affectedIsMinor: row.affected_is_minor,
      occurredAt: toIsoString(row.occurred_at),
      location: row.location,
      activity: row.activity,
      incidentType: row.incident_type as
        | "injury"
        | "near_miss"
        | "dangerous_occurrence"
        | "ill_health"
        | "property_damage",
      description: row.description,
      injuryOccurred: row.injury_occurred,
      natureOfInjury: row.nature_of_injury,
      bodyPartsAffected: row.body_parts_affected,
      injurySeverity: row.injury_severity as
        | "minor"
        | "serious"
        | "fatal"
        | null,
      firstAidGiven: row.first_aid_given,
      firstAiderName: row.first_aider_name,
      firstAidDetails: row.first_aid_details,
      medicalTreatmentRequired: row.medical_treatment_required,
      immediateActions: row.immediate_actions,
      witnesses: row.witnesses,
      declarationConfirmed: row.declaration_confirmed,
      status: row.status as "new" | "in_review" | "done",
      severity: row.severity as "low" | "medium" | "high" | null,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      actionsTaken: row.actions_taken,
      targetCompletionDate: toIsoStringNullable(row.target_completion_date),
      riddorRequired: row.riddor_required,
      riddorReportedAt: toIsoStringNullable(row.riddor_reported_at),
      internalNotes: row.internal_notes,
      closureReason: row.closure_reason,
      closedAt: toIsoStringNullable(row.closed_at),
      safeguardingDiscussed: row.safeguarding_discussed,
      safeguardingDiscussedAt: toIsoStringNullable(
        row.safeguarding_discussed_at,
      ),
      safeguardingNotes: row.safeguarding_notes,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  };
}

export function updateIncidentReport(db: Kysely<DB>) {
  return async (id: string, update: IncidentReportAdminUpdate) => {
    await db
      .updateTable("accident_incident_report")
      .set({
        updated_at: new Date().toISOString(),
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.severity !== undefined ? { severity: update.severity } : {}),
        ...(update.ownerUserId !== undefined
          ? { owner_user_id: update.ownerUserId }
          : {}),
        ...(update.actionsTaken !== undefined
          ? { actions_taken: update.actionsTaken }
          : {}),
        ...(update.targetCompletionDate !== undefined
          ? { target_completion_date: update.targetCompletionDate }
          : {}),
        ...(update.riddorRequired !== undefined
          ? { riddor_required: update.riddorRequired }
          : {}),
        ...(update.riddorReportedAt !== undefined
          ? { riddor_reported_at: update.riddorReportedAt }
          : {}),
        ...(update.internalNotes !== undefined
          ? { internal_notes: update.internalNotes }
          : {}),
        ...(update.closureReason !== undefined
          ? { closure_reason: update.closureReason }
          : {}),
        ...(update.closedAt !== undefined
          ? { closed_at: update.closedAt }
          : {}),
        ...(update.safeguardingDiscussed !== undefined
          ? { safeguarding_discussed: update.safeguardingDiscussed }
          : {}),
        ...(update.safeguardingDiscussedAt !== undefined
          ? { safeguarding_discussed_at: update.safeguardingDiscussedAt }
          : {}),
        ...(update.safeguardingNotes !== undefined
          ? { safeguarding_notes: update.safeguardingNotes }
          : {}),
      })
      .where("id", "=", id)
      .execute();

    return { success: true };
  };
}
