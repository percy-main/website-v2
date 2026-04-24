import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── lead ──
  await sql`
    CREATE TABLE lead (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      source TEXT NOT NULL,
      first_campaign_id TEXT,
      first_segment TEXT,
      attribution JSONB,
      consent_ad_user_data TEXT NOT NULL DEFAULT 'unknown',
      consent_ad_storage TEXT NOT NULL DEFAULT 'unknown',
      consent_version TEXT,
      consent_recorded_at TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      member_id TEXT REFERENCES member(id),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )
  `.execute(db);

  await sql`COMMENT ON COLUMN lead.status IS 'Denormalised from marketing_event; event rows are the source of truth.'`.execute(
    db,
  );

  await sql`CREATE INDEX idx_lead_email ON lead (email)`.execute(db);
  await sql`CREATE INDEX idx_lead_first_campaign_created ON lead (first_campaign_id, created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_lead_status_created ON lead (status, created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_lead_member ON lead (member_id)`.execute(db);

  // ── marketing_event ──
  await sql`
    CREATE TABLE marketing_event (
      id TEXT PRIMARY KEY,
      lead_id TEXT REFERENCES lead(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES "user"(id),
      type TEXT NOT NULL,
      campaign_id TEXT,
      segment TEXT,
      ads_conversion_action TEXT,
      value_pence INTEGER,
      currency TEXT,
      attribution JSONB,
      payload JSONB,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES "user"(id)
    )
  `.execute(db);

  await sql`CREATE INDEX idx_marketing_event_type_created ON marketing_event (type, created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_marketing_event_lead ON marketing_event (lead_id)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_marketing_event_campaign_type_created ON marketing_event (campaign_id, type, created_at)`.execute(
    db,
  );
  await sql`
    CREATE INDEX idx_marketing_event_ads_action_created
      ON marketing_event (ads_conversion_action, created_at)
      WHERE ads_conversion_action IS NOT NULL
  `.execute(db);

  // ── marketing_outbox ──
  await sql`
    CREATE TABLE marketing_outbox (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES marketing_event(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      succeeded_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  await sql`CREATE INDEX idx_marketing_outbox_status_next_attempt ON marketing_outbox (status, next_attempt_at)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_marketing_outbox_event ON marketing_outbox (event_id)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS marketing_outbox`.execute(db);
  await sql`DROP TABLE IF EXISTS marketing_event`.execute(db);
  await sql`DROP TABLE IF EXISTS lead`.execute(db);
}
