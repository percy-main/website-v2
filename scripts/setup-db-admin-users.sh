#!/usr/bin/env bash
# setup-db-admin-users.sh — Create admin_ro / admin_rw Postgres roles in
# production RDS, generate random passwords, and store them in Secrets
# Manager for retrieval by admin tooling (TablePlus, psql, etc.).
#
# Safe to re-run: if passwords already exist in Secrets Manager they are
# reused. If the DB roles already exist the CREATE ROLE statements will
# fail — that's the signal the bootstrap has already happened.
#
# Usage:
#   ./scripts/setup-db-admin-users.sh
#
# Prerequisites:
#   - AWS CLI v2 configured (profile: percy-main)
#   - jq, openssl, psql installed
#   - Tailscale up (or willingness to use bastion tunnel — see RUN_MODE below)
#
# By default runs via the same bastion mechanism as bastion-sql.sh. Set
# RUN_MODE=tailscale to connect directly over the tailnet instead (faster,
# assumes the Tailscale subnet router is live and your laptop is on the
# tailnet).

set -euo pipefail

PROFILE="percy-main"
REGION="eu-west-2"
RDS_IDENTIFIER="percy-main-production-db"
RDS_SECRET_ID="percy-main-production/rds/credentials"
RO_SECRET_ID="percy-main-production/rds/admin-ro"
RW_SECRET_ID="percy-main-production/rds/admin-rw"
RUN_MODE="${RUN_MODE:-bastion}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

gen_password() {
  # 32 chars, alphanumeric + safe symbols (no quote/backslash/dollar)
  openssl rand -base64 48 | tr -d '=+/' | head -c 32
}

ensure_secret() {
  local secret_id="$1"
  local description="$2"

  if aws --profile "$PROFILE" --region "$REGION" secretsmanager describe-secret \
    --secret-id "$secret_id" >/dev/null 2>&1; then
    echo "  ✓ $secret_id already exists — reusing"
    aws --profile "$PROFILE" --region "$REGION" secretsmanager get-secret-value \
      --secret-id "$secret_id" --query SecretString --output text
  else
    echo "  + creating $secret_id"
    local pw
    pw=$(gen_password)
    aws --profile "$PROFILE" --region "$REGION" secretsmanager create-secret \
      --name "$secret_id" \
      --description "$description" \
      --secret-string "$pw" >/dev/null
    echo "$pw"
  fi
}

# -----------------------------------------------------------------------------
# Generate / retrieve passwords
# -----------------------------------------------------------------------------

echo "Ensuring admin passwords exist in Secrets Manager..."
RO_PASS=$(ensure_secret "$RO_SECRET_ID" "Postgres admin_ro role password — read-only DB access for operators")
RW_PASS=$(ensure_secret "$RW_SECRET_ID" "Postgres admin_rw role password — read-write DB access for operators (use with care)")

# -----------------------------------------------------------------------------
# Master credentials
# -----------------------------------------------------------------------------

RDS_CREDS=$(aws --profile "$PROFILE" --region "$REGION" secretsmanager get-secret-value \
  --secret-id "$RDS_SECRET_ID" --query 'SecretString' --output text)
RDS_USER=$(echo "$RDS_CREDS" | jq -r '.username')
RDS_PASS=$(echo "$RDS_CREDS" | jq -r '.password')
RDS_DBNAME=$(echo "$RDS_CREDS" | jq -r '.dbname')

# -----------------------------------------------------------------------------
# SQL — idempotent-ish role and privilege grants
# The `CREATE ROLE` statements will fail on a second run; the GRANTs are
# idempotent. Run once at setup.
# -----------------------------------------------------------------------------

SQL_FILE=$(mktemp -t setup-db-admin-users.XXXXXX.sql)
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<'SQL'
\set ON_ERROR_STOP on

BEGIN;

-- ── admin_ro: read-only ──────────────────────────────────────────────────────
CREATE ROLE admin_ro WITH LOGIN PASSWORD :'ro_pass';
GRANT CONNECT ON DATABASE percy_main TO admin_ro;
GRANT USAGE ON SCHEMA public TO admin_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_ro;
-- Future tables created by the app/migration user inherit SELECT
ALTER DEFAULT PRIVILEGES FOR ROLE percy IN SCHEMA public
  GRANT SELECT ON TABLES TO admin_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE percy IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO admin_ro;

-- ── admin_rw: read-write with guardrails ─────────────────────────────────────
-- Deliberately NOT given SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS
CREATE ROLE admin_rw WITH LOGIN PASSWORD :'rw_pass';
GRANT CONNECT ON DATABASE percy_main TO admin_rw;
GRANT USAGE ON SCHEMA public TO admin_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admin_rw;
GRANT USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public TO admin_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE percy IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE percy IN SCHEMA public
  GRANT USAGE, UPDATE ON SEQUENCES TO admin_rw;

-- Guardrails: short statement timeout + log all writes for audit
ALTER ROLE admin_rw SET statement_timeout = '30s';
ALTER ROLE admin_rw SET log_statement = 'mod';

COMMIT;
SQL

# -----------------------------------------------------------------------------
# Execute SQL
# -----------------------------------------------------------------------------

run_psql_tailscale() {
  local host
  host=$(aws --profile "$PROFILE" --region "$REGION" rds describe-db-instances \
    --db-instance-identifier "$RDS_IDENTIFIER" \
    --query 'DBInstances[0].Endpoint.Address' --output text)
  echo "Running SQL via Tailscale against $host..."
  PGPASSWORD="$RDS_PASS" psql \
    -h "$host" -p 5432 -U "$RDS_USER" -d "$RDS_DBNAME" \
    --set=sslmode=require \
    -v ro_pass="$RO_PASS" \
    -v rw_pass="$RW_PASS" \
    -f "$SQL_FILE"
}

run_psql_bastion() {
  echo "Running SQL via ephemeral bastion..."
  # Reuse bastion-sql.sh's tunnel lifecycle by invoking a single no-op SQL,
  # while we run the real psql against the tunneled port ourselves. Simpler:
  # just inline the bastion logic here, keyed off bastion-sql.sh's patterns.
  # Since re-implementing that cleanly is out of scope, delegate: we invoke
  # bastion-sql.sh with a command that pipes our SQL file through a bash
  # heredoc. But that leaks passwords via process args.
  #
  # Instead: require Tailscale for this one-shot setup. The bastion path is
  # listed as a fallback in the ADR — if you genuinely cannot get on the
  # tailnet, extend bastion-sql.sh to support `-f file` and retry.
  echo "ERROR: bastion mode not supported for this script — Tailscale must be up." >&2
  echo "       (Would require leaking passwords via CLI args. Not worth the footgun.)" >&2
  echo "       If you need the bastion fallback, extend bastion-sql.sh to accept" >&2
  echo "       a SQL file via stdin/-f first, then set RUN_MODE=bastion." >&2
  exit 2
}

case "$RUN_MODE" in
  tailscale) run_psql_tailscale ;;
  bastion)   run_psql_bastion ;;
  *)
    echo "ERROR: unknown RUN_MODE=$RUN_MODE (expected: tailscale|bastion)" >&2
    exit 2
    ;;
esac

echo ""
echo "✓ Done. Secrets:"
echo "    $RO_SECRET_ID  (admin_ro)"
echo "    $RW_SECRET_ID  (admin_rw)"
echo ""
echo "  Connection string (RO):"
echo "    psql \"postgresql://admin_ro:\$(aws secretsmanager get-secret-value --secret-id $RO_SECRET_ID --query SecretString --output text --profile $PROFILE --region $REGION)@$(aws rds describe-db-instances --db-instance-identifier $RDS_IDENTIFIER --query 'DBInstances[0].Endpoint.Address' --output text --profile $PROFILE --region $REGION):5432/percy_main?sslmode=require\""
