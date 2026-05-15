# ADR 043: Database role split - principle of least privilege

## Status

Accepted

## Context

The Fastify API connected to RDS as the **RDS master user** (`percy`, `rds_superuser`) using credentials stored under `percy-main-production/rds/credentials`. A compromised ECS task - RCE, SSRF into IMDS, leaky dependency - would therefore have gotten effective superuser on production: full DDL, role management, replication, bypass-RLS. The app runs third-party code every deploy, so this is not a theoretical risk.

The migration runner ran with the same master credentials, blurring the runtime / schema-change separation that lets us reason about "what could the app have done?" during an incident.

Surfaced during security review of the Tailscale DB-access plan (#216 / ADR 039). Tracked as #130.

## Decision

Three Postgres roles, three different jobs:

| Role      | Login? | Scope                                                    | Used by               |
| --------- | ------ | -------------------------------------------------------- | --------------------- |
| `percy`   | yes    | RDS master (rds_superuser equivalent)                    | Break-glass only      |
| `app_rw`  | yes    | CRUD on tables, USAGE on sequences, **no DDL**           | API runtime           |
| `app_ddl` | yes    | CREATE on schema, ownership of all public-schema objects | Migration runner only |

The two app roles are created `NOLOGIN` by a Kysely migration (timestamp `2026-05-15T06:53:37.877Z`). Their passwords are minted by Terraform `random_password` resources and stored in dedicated Secrets Manager entries (`percy-main-production/rds/app_rw`, `…/rds/app_ddl`). An operator sets `LOGIN` + the password on each role once after first apply, via psql over the Tailscale subnet router (see [Bootstrap](#bootstrap) below).

Cutover is gated by a Terraform variable `app_rw_active` (default `false`). While false, the API and migration task definitions keep reading the master credentials - exactly the pre-#130 behaviour. Flipping it to `true` (after operator-bootstrap) switches:

- API task `DATABASE_URL` → app_rw secret
- Migration task `DATABASE_URL` → app_ddl secret
- Master credentials secret → resource-policy denies all principals except those in `master_db_break_glass_principal_arns`

The migration runner is a **separate ECS task definition** (`production-api-migrate`), not a `containerOverrides.command` on the API task def. This is what makes the role split meaningful at runtime: ECS injects secrets into env at container startup from the _task definition_, so a compromised API container only ever sees `DATABASE_URL = app_rw` in its env - never the `app_ddl` URL - even though the task execution role's IAM policy still allows reading both secrets (the broad `secret:*percy-main*` allow). The task execution role does the injection; the task role is what the running process uses for SDK calls, and the task role has no `secretsmanager:GetSecretValue` permission at all.

## Bootstrap

Required once, after the PR merges and CI applies. The cutover flag stays `false` until step 4.

1. **Apply the role-split migration.** CI's normal deploy runs `apps/api/dist/migrate.js` against the master URL. The migration creates `app_rw` and `app_ddl` as `NOLOGIN`, walks `pg_class` to hand every public-schema object's ownership to `app_ddl`, sets default privileges so future migrations grant CRUD on new tables to `app_rw`, and revokes the legacy `CREATE ON SCHEMA public FROM PUBLIC` grant.

2. **Read the new role passwords from Secrets Manager.**

   ```sh
   aws --profile percy-main secretsmanager get-secret-value \
     --secret-id percy-main-production/rds/app_rw \
     --query SecretString --output text | jq -r .password
   aws --profile percy-main secretsmanager get-secret-value \
     --secret-id percy-main-production/rds/app_ddl \
     --query SecretString --output text | jq -r .password
   ```

3. **Set `LOGIN` + password on each role over Tailscale.** The master password is still freely readable at this stage (the deny policy turns on with the flag at step 4). From an admin laptop on the tailnet:

   ```sh
   PGPASSWORD=<master> psql -h <rds-host> -U percy -d percy_main <<'SQL'
   ALTER USER app_rw  WITH LOGIN PASSWORD '<from secret>';
   ALTER USER app_ddl WITH LOGIN PASSWORD '<from secret>';
   SQL
   ```

   Both roles can now log in with the Terraform-managed passwords. Connectivity test:

   ```sh
   PGPASSWORD=<app_rw_password> psql -h <rds-host> -U app_rw -d percy_main -c 'SELECT 1'
   PGPASSWORD=<app_ddl_password> psql -h <rds-host> -U app_ddl -d percy_main -c 'SELECT 1'
   ```

4. **Flip the cutover flag.** One-line PR: set `app_rw_active = true` in `infra/environments/production/variables.tf`. CI applies → API task def re-registers with `DATABASE_URL → app_rw` → next deploy uses the split, and the master credentials secret gets its deny-all-except-break-glass-role resource policy. `master_db_break_glass_principal_arns` stays empty by default - the dedicated break-glass IAM role is the standard access path.

5. **(Optional) Rotate the master password.** Once the app is running against `app_rw` and `app_ddl` for at least one full deploy cycle:

   ```sh
   PGPASSWORD=<old master> psql -h <rds-host> -U percy -d percy_main \
     -c "ALTER USER percy WITH PASSWORD '<new random>'"
   aws --profile percy-main secretsmanager put-secret-value \
     --secret-id percy-main-production/rds/credentials \
     --secret-string '<json with new password>'
   ```

   The Terraform-managed `random_password.db` has `ignore_changes = all`, so this rotation is operator-driven and does not show up in plan. `aws_secretsmanager_secret_version.db_credentials` also carries `lifecycle.ignore_changes = [secret_string]` so the next apply does not revert the rotated value.

## Break-glass recovery

The master credentials secret has a resource policy (when `app_rw_active = true`) that denies `GetSecretValue` from every principal except:

- **`percy-main-db-break-glass`** - a dedicated IAM role with one permission: `secretsmanager:GetSecretValue` on the master credentials secret. Admins assume it on demand; the assumption is the audit point. Trust policy accepts any IAM principal in the account that proves MFA, so admin IAM remains the gate on _who can use it_. Session capped at 1h.
- the two Terraform roles (`terraform_role_arn`, `terraform_plan_role_arn`) - required for `aws_secretsmanager_secret_version.db_credentials` refresh / plan ops; without this exemption Terraform breaks. Accepted as a documented trade-off: those roles are hardened, audited, and not held by humans day-to-day.
- any extra principals listed in `master_db_break_glass_principal_arns` (default empty) - escape hatch for one-off auditor / vendor access.

Every assumption of the break-glass role fires an EventBridge → SNS event on `percy-main-shared-security-events` (eu-west-2 + us-east-1). Subscribe an email or Slack target to that topic so an unexpected `AssumeRole` is visible within seconds, not on a quarterly audit review.

Recovery flow:

1. Admin assumes the break-glass role (must be MFA-authenticated):

   ```sh
   aws sts assume-role \
     --role-arn arn:aws:iam::<account>:role/percy-main-db-break-glass \
     --role-session-name "incident-$(date +%Y%m%d-%H%M)-<short-reason>" \
     --duration-seconds 1800
   ```

   Export the returned `AccessKeyId` / `SecretAccessKey` / `SessionToken` into the shell.

2. `aws secretsmanager get-secret-value --secret-id percy-main-production/rds/credentials` returns the master password.

3. Connect over Tailscale as `percy`. Do the recovery work (schema repair, role unbreak, password reset).

4. After resolution, rotate the master password and the app_rw / app_ddl passwords if there's any chance they were exposed.

The allowlist is intentionally small - the master secret is no longer a credential the app needs, it's an emergency escape hatch that leaves an unmistakable trail when used.

## Why not the alternatives

- **Single `app_rw` role with `CREATE`, run migrations as it.** Loses the "what could the app have done?" boundary. A leaky dependency could `DROP TABLE membership` just as easily as a stolen master password. The whole point is that the API runtime _cannot_ run DDL.

- **Run migrations as master forever, just split the runtime role.** Mostly works, but keeps the master credential in CI's hot path. Any future "let's run a quick migration from a laptop" would need master access. With a dedicated `app_ddl` role, day-to-day schema changes route through a credential whose blast radius is bounded to the `public` schema.

- **In-app DB-level row security (RLS).** Useful for multi-tenant SaaS but mismatched to a single-tenant club site. RLS would force every query to carry a tenant predicate; for this codebase that's pure churn. The role split protects against compromise at the right altitude (DDL, replication, role management) without rewriting queries.

- **Same task definition for API + migration, use ECS `containerOverrides` to swap secrets.** ECS doesn't allow `secrets` in `containerOverrides` - only `command` and `environment`. Injecting `app_ddl` via plain-text `environment` override would put the password into CloudTrail `RunTask` events and the workflow run logs. Hence a separate task def.

- **Split the task execution role too, so the API IAM literally can't read the `app_ddl` secret.** Defensible but redundant: the task role (what a runtime-compromised API would use for AWS SDK calls) has no `secretsmanager:GetSecretValue` permission to begin with, so even broad task-execution IAM doesn't leak the secret at runtime. Splitting the execution role would protect against ECS-agent-side compromise - a much more exotic attack - and double the IAM surface area to maintain. Deferred.

## Consequences

- **Routine deploys are unchanged.** Same Docker image runs in both task defs; the workflow patches `IMAGE` + `RELEASE_SHA` on both and registers new revisions on every deploy.
- **Manual migrations from a laptop** must connect as `app_ddl` (over Tailscale), not master. Local `pnpm db:up` reads `DATABASE_MIGRATION_URL` first, falling back to `DATABASE_URL` for the dev superuser case.
- **New tables created by future migrations** are automatically owned by `app_ddl` and granted CRUD to `app_rw` (via the `ALTER DEFAULT PRIVILEGES FOR ROLE app_ddl` set on apply). No per-migration grant boilerplate.
- **CI's `ecs:RunTask` IAM allow** now covers `*-api-migrate:*` as well as `*-api:*` (shared module).
- **Local dev needs a one-time bootstrap.** `pnpm --filter @percy-main/db run db:setup-app-roles` ALTERs both roles to `LOGIN` with known dev passwords and prints the `.env` lines.
- **The migration history table (`kysely_migration`)** is owned by `app_ddl` post-apply. The down migration hands it back to the master before dropping the roles.

## Trigger to revisit

- A real incident where the role split helped (or didn't) - capture the timeline.
- Adding a second long-running process that needs DB access: re-evaluate whether `app_rw` is the right scope or whether a third role (e.g. `app_ro` for the public site) is worth introducing. The issue notes "probably not worth it at this scale" - re-test when traffic grows or when ratio of read/write traffic shifts materially.
- AWS adding native support for ECS task-level secrets injection that's truly scoped per task def (today's behaviour is task-def-scoped only insofar as the task definition declares the secret - it's not enforced beyond that).
