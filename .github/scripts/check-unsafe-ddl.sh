#!/usr/bin/env bash
# Fail PR CI if any added/modified migration in packages/db/src/migrations
# contains unsafe DDL patterns (DROP COLUMN, DROP TABLE, ALTER COLUMN
# ... SET NOT NULL on existing data) unless a commit on the PR contains
# the literal token `safe-ddl-ack:` in its message — opt-out for cases
# where the change really is safe (e.g., column was added in a prior
# release and never used).
#
# Designed to run on PRs (where origin/main..HEAD is non-empty). Skips
# itself silently otherwise.

set -euo pipefail

BASE_REF="${1:-origin/main}"

if ! git rev-parse --verify "${BASE_REF}" >/dev/null 2>&1; then
  echo "check-unsafe-ddl: base ref '${BASE_REF}' not found, skipping"
  exit 0
fi

# Use --diff-filter=AM to catch added or modified migration files
# (renames included via M; deletions ignored — undoing a migration is
# itself a smell but not what this guardrail is for).
mapfile -t CHANGED < <(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" -- 'packages/db/src/migrations/*.ts' 2>/dev/null || true)

if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "check-unsafe-ddl: no migration files changed"
  exit 0
fi

# Pattern set:
#  - dropColumn / dropTable / setNotNull  — Kysely schema-builder calls
#  - DROP COLUMN / DROP TABLE             — raw SQL
#  - SET NOT NULL                         — raw SQL constraint add
# `setNotNull` matches both .setNotNull() (ColumnDefinitionBuilder) and
# alterColumn(..., (ac) => ac.setNotNull()) — the most common Kysely
# shape for adding NOT NULL to an existing column.
PATTERNS='dropColumn|dropTable|setNotNull|DROP COLUMN|DROP TABLE|SET NOT NULL'

HITS=()
for f in "${CHANGED[@]}"; do
  if grep -iE "${PATTERNS}" "$f" >/dev/null 2>&1; then
    HITS+=("$f")
  fi
done

if [ "${#HITS[@]}" -eq 0 ]; then
  echo "check-unsafe-ddl: no unsafe DDL detected in ${#CHANGED[@]} changed migration(s)"
  exit 0
fi

# Allow opt-out via commit message token.
if git log --format=%B "${BASE_REF}..HEAD" | grep -q 'safe-ddl-ack:'; then
  echo "check-unsafe-ddl: unsafe DDL detected but 'safe-ddl-ack:' token present in commit message — allowing"
  printf '  - %s\n' "${HITS[@]}"
  exit 0
fi

echo "::error::Unsafe DDL detected. Migrations contain destructive patterns (${PATTERNS})"
echo "Files:"
printf '  - %s\n' "${HITS[@]}"
echo ""
echo "If this change is safe (e.g. backfilled column, gated by feature flag),"
echo "add a 'safe-ddl-ack: <reason>' line to a commit message on this PR."
exit 1
