#!/usr/bin/env bash
# db-restore.sh — Restore a pg_dump file into the local Docker PostgreSQL.
#
# Usage:
#   ./scripts/db-restore.sh dumps/prod-20260325-180000.sql
#   ./scripts/db-restore.sh dumps/prod-20260325-180000.sql --target postgres://user:pass@host:port/db
#
# Defaults to the local Docker Compose database (localhost:5433).
# The dump's --clean --if-exists flags will drop and recreate tables.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/db-restore.sh <dump-file> [--target <connection-string>]"
  echo ""
  echo "  dump-file   Path to a pg_dump SQL file (e.g. dumps/prod-20260325-180000.sql)"
  echo "  --target    PostgreSQL connection string (default: postgres://percy:percy@localhost:5433/percy_main)"
  exit 1
fi

DUMP_FILE="$1"
shift

TARGET_URL="postgres://percy:percy@localhost:5433/percy_main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target|-t)
      TARGET_URL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: Dump file not found: $DUMP_FILE"
  exit 1
fi

# Safety: refuse to restore to anything that doesn't look local (unless --target was explicit)
PARSED_HOST=$(node -e "process.stdout.write(new URL(process.argv[1]).hostname)" -- "$TARGET_URL")
LOCAL_HOSTS=("localhost" "127.0.0.1" "::1")
IS_LOCAL=false
for h in "${LOCAL_HOSTS[@]}"; do
  if [[ "$PARSED_HOST" == "$h" ]]; then
    IS_LOCAL=true
    break
  fi
done

if [[ "$IS_LOCAL" != "true" ]]; then
  echo "ERROR: Refusing to restore to non-local database (hostname: $PARSED_HOST)."
  echo "       This script is intended for local development only."
  exit 1
fi

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "Restoring $DUMP_FILE ($DUMP_SIZE) to $TARGET_URL"
echo ""

# Use psql to execute the dump (which contains SQL statements from pg_dump --clean --if-exists)
psql "$TARGET_URL" -f "$DUMP_FILE"

# Re-apply the scout_readonly LOGIN + dev password. The migration creates the
# role as NOLOGIN; setup-scout flips it to LOGIN with the known dev password
# that apps/api/.env's SCOUT_DB_URL expects. Dumps from prod strip role state
# (--no-owner --no-privileges), so without this step Scout's sub-agent gets
# "password authentication failed for scout_readonly" after every restore.
echo ""
echo "Reapplying scout_readonly LOGIN + dev password..."
DATABASE_URL="$TARGET_URL" pnpm --filter @percy-main/db run db:setup-scout

echo ""
echo "Restore complete."
