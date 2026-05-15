import { type Kysely, sql } from "kysely";

// Principle-of-least-privilege roles for the application runtime.
//
// app_rw: API runtime. CRUD on tables, USAGE on sequences, no DDL.
// app_ddl: migration runner only. CREATE on schema; takes ownership of
//   new objects via default privileges so app_rw can keep reading/writing
//   them after future migrations.
//
// Both are created NOLOGIN — passwords + LOGIN are set out-of-band per
// environment (Terraform-minted secret + admin ALTER USER in prod; the
// setup-app-roles dev script locally). This mirrors the scout_readonly
// pattern and keeps credentials out of migration history.
//
// See docs/adrs/ for the role split rationale + break-glass plan for the
// RDS master account.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE ROLE app_rw NOLOGIN`.execute(db);
  await sql`CREATE ROLE app_ddl NOLOGIN`.execute(db);

  // PG14 and the RDS-provisioned percy_main carry the pre-PG15 default
  // that grants CREATE on schema public to PUBLIC (every role). Drop it
  // so only roles with an explicit CREATE grant (app_ddl, master) can
  // run DDL. Without this, app_rw can still CREATE TABLE despite never
  // being granted CREATE directly.
  await sql`REVOKE CREATE ON SCHEMA public FROM PUBLIC`.execute(db);

  // ── app_rw: runtime CRUD only ──
  await sql`
    DO $$ BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rw', current_database());
    END $$;
  `.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO app_rw`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw`.execute(
    db,
  );
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw`.execute(
    db,
  );
  // Default privileges are scoped by the creating role — app_ddl creates
  // new objects going forward, so its FOR ROLE clause is what counts.
  await sql`ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw`.execute(db);
  await sql`ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_rw`.execute(db);

  // ── app_ddl: schema migrations only ──
  await sql`
    DO $$ BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_ddl', current_database());
    END $$;
  `.execute(db);
  await sql`GRANT USAGE, CREATE ON SCHEMA public TO app_ddl`.execute(db);
  // Hand every existing public-schema table, sequence, and view to
  // app_ddl. Plain REASSIGN OWNED BY <master> won't work — the master
  // also owns the database itself ("required by the database system"),
  // so we walk pg_class instead and only touch objects in `public`.
  //
  // Identity/SERIAL sequences (pg_depend.deptype='a') travel with their
  // owning column — ALTER SEQUENCE OWNER fails on them, so skip those
  // and let the table-level ALTER carry them.
  await sql`
    DO $$
    DECLARE
      obj record;
    BEGIN
      FOR obj IN
        SELECT n.nspname, c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            WHERE d.objid = c.oid
              AND d.classid = 'pg_class'::regclass
              AND d.deptype = 'a'
          )
      LOOP
        EXECUTE format(
          'ALTER %s %I.%I OWNER TO app_ddl',
          CASE obj.relkind
            WHEN 'r' THEN 'TABLE'
            WHEN 'p' THEN 'TABLE'
            WHEN 'S' THEN 'SEQUENCE'
            WHEN 'v' THEN 'VIEW'
            WHEN 'm' THEN 'MATERIALIZED VIEW'
          END,
          obj.nspname,
          obj.relname
        );
      END LOOP;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Hand public-schema objects back to whoever runs the down (the master
  // in production, the testcontainer user in tests) before dropping the
  // roles — otherwise DROP ROLE fails on dependent objects.
  await sql`
    DO $$
    DECLARE
      obj record;
      target text := session_user;
    BEGIN
      FOR obj IN
        SELECT n.nspname, c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'app_ddl')
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            WHERE d.objid = c.oid
              AND d.classid = 'pg_class'::regclass
              AND d.deptype = 'a'
          )
      LOOP
        EXECUTE format(
          'ALTER %s %I.%I OWNER TO %I',
          CASE obj.relkind
            WHEN 'r' THEN 'TABLE'
            WHEN 'p' THEN 'TABLE'
            WHEN 'S' THEN 'SEQUENCE'
            WHEN 'v' THEN 'VIEW'
            WHEN 'm' THEN 'MATERIALIZED VIEW'
          END,
          obj.nspname,
          obj.relname,
          target
        );
      END LOOP;
    END $$;
  `.execute(db);
  await sql`DROP OWNED BY app_ddl`.execute(db);
  await sql`DROP OWNED BY app_rw`.execute(db);
  await sql`DROP ROLE app_ddl`.execute(db);
  await sql`DROP ROLE app_rw`.execute(db);
  await sql`GRANT CREATE ON SCHEMA public TO PUBLIC`.execute(db);
}
