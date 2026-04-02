import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── document ──
  await sql`
    CREATE TABLE document (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      created_by TEXT NOT NULL REFERENCES "user"(id),
      updated_by TEXT NOT NULL REFERENCES "user"(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  // ── document_assignment ──
  await sql`
    CREATE TABLE document_assignment (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES document(id),
      user_id TEXT NOT NULL REFERENCES "user"(id),
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_by TEXT NOT NULL REFERENCES "user"(id),
      confirmed_at TEXT,
      confirmed_version INTEGER,
      UNIQUE (document_id, user_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_document_assignment_document ON document_assignment (document_id)
  `.execute(db);

  await sql`
    CREATE INDEX idx_document_assignment_user ON document_assignment (user_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS document_assignment`.execute(db);
  await sql`DROP TABLE IF EXISTS document`.execute(db);
}
