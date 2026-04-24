import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE accident_incident_report (
      id TEXT PRIMARY KEY,

      -- Reporter (PMCSC form Section 1: Personal Details)
      reporter_name TEXT NOT NULL,
      reporter_email TEXT NOT NULL,
      reporter_phone TEXT,
      reporter_relationship TEXT NOT NULL,
      prefers_no_contact BOOLEAN NOT NULL DEFAULT FALSE,

      -- Affected person (Section 1: Details of the Injured / Affected Person)
      affected_name TEXT,
      affected_relationship TEXT,
      affected_contact TEXT,
      affected_is_minor BOOLEAN NOT NULL DEFAULT FALSE,

      -- Incident details (Section 1: Accident / Incident Details)
      occurred_at TIMESTAMPTZ NOT NULL,
      location TEXT NOT NULL,
      activity TEXT,
      incident_type TEXT NOT NULL,
      description TEXT NOT NULL,

      -- Injury / ill health details (Section 1)
      injury_occurred BOOLEAN NOT NULL DEFAULT FALSE,
      nature_of_injury TEXT,
      body_parts_affected TEXT,
      injury_severity TEXT,
      first_aid_given BOOLEAN NOT NULL DEFAULT FALSE,
      first_aider_name TEXT,
      first_aid_details TEXT,
      medical_treatment_required BOOLEAN NOT NULL DEFAULT FALSE,

      -- Immediate actions and witnesses (Section 1)
      immediate_actions TEXT,
      witnesses TEXT,

      -- Declaration (Section 1): reporter must confirm before submission.
      declaration_confirmed BOOLEAN NOT NULL,

      -- Admin / responsible person (Section 2)
      status TEXT NOT NULL DEFAULT 'new',
      severity TEXT,
      owner_user_id TEXT REFERENCES "user"(id),
      actions_taken TEXT,
      target_completion_date TIMESTAMPTZ,
      riddor_required BOOLEAN,
      riddor_reported_at TIMESTAMPTZ,
      internal_notes TEXT,
      closure_reason TEXT,
      closed_at TIMESTAMPTZ,
      safeguarding_discussed BOOLEAN NOT NULL DEFAULT FALSE,
      safeguarding_discussed_at TIMESTAMPTZ,
      safeguarding_notes TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_accident_incident_report_status
      ON accident_incident_report (status)
  `.execute(db);

  await sql`
    CREATE INDEX idx_accident_incident_report_created_at
      ON accident_incident_report (created_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS accident_incident_report`.execute(db);
}
