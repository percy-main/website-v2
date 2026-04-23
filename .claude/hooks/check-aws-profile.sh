#!/usr/bin/env bash
# PreToolUse:Bash hook — block `aws` commands unless they use the percy-main profile.
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')

if [[ -z "$cmd" ]]; then
  exit 0
fi

# Match `aws` as a command word: start of line, or after `;`, `&`, `|`, `(`, or `$(`
if echo "$cmd" | grep -qE '(^|[;&|(]|\$\()[[:space:]]*aws([[:space:]]|$)'; then
  if echo "$cmd" | grep -qE -- '(--profile[=[:space:]]+percy-main|AWS_PROFILE=percy-main)'; then
    exit 0
  fi
  echo "aws commands must use --profile percy-main (or set AWS_PROFILE=percy-main). See .claude/CLAUDE.md." >&2
  exit 2
fi

exit 0
