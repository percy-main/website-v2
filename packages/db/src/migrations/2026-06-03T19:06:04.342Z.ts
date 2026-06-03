import { type Kysely, sql } from "kysely";

// Restore operator (admin_ro / admin_rw) access to objects created after the
// ADR-043 role split.
//
// scripts/setup-db-admin-users.sh granted the operator roles SELECT (ro) and
// CRUD (rw) on the then-existing tables, plus default privileges scoped
// `FOR ROLE percy`. After the role split (migration 2026-05-15T06:53:37.877Z),
// `app_ddl` owns and creates every public-schema object, so the `FOR ROLE
// percy` default privileges no longer apply to anything. The split migration
// fixed this for the app runtime (`... FOR ROLE app_ddl ... TO app_rw`) but
// never for the operator roles. Result: every table created post-cutover
// (e.g. push_subscription, notification_preferences) is invisible to admin_ro
// and admin_rw.
//
// This migration back-grants the operator privileges on all existing objects
// and adds the missing `FOR ROLE app_ddl` default privileges so future
// migrations carry the grants forward.
//
// admin_ro / admin_rw are PROD-ONLY roles provisioned out-of-band (not by a
// migration), so they are absent locally and in testcontainers. Every grant is
// guarded on role existence and no-ops where the roles don't exist. In prod
// the migration runs as app_ddl, which owns the objects and is (trivially) a
// member of itself, so it can issue the GRANTs and the FOR ROLE app_ddl
// ALTER DEFAULT PRIVILEGES.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_ro') THEN
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_ro;
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_ro;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          GRANT SELECT ON TABLES TO admin_ro;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          GRANT SELECT ON SEQUENCES TO admin_ro;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_rw') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admin_rw;
        GRANT USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public TO admin_rw;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_rw;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          GRANT USAGE, UPDATE ON SEQUENCES TO admin_rw;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_ro') THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          REVOKE SELECT ON TABLES FROM admin_ro;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          REVOKE SELECT ON SEQUENCES FROM admin_ro;
        REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM admin_ro;
        REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public FROM admin_ro;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_rw') THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM admin_rw;
        ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl IN SCHEMA public
          REVOKE USAGE, UPDATE ON SEQUENCES FROM admin_rw;
        REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM admin_rw;
        REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM admin_rw;
      END IF;
    END $$;
  `.execute(db);
}
