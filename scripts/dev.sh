#!/usr/bin/env bash
# Start the full local dev environment:
#   1. Stripe CLI webhook forwarding (extracts signing secret automatically)
#   2. API, web, and email-viewer dev servers
#
# The Stripe webhook secret is captured from the CLI output and exported
# so the API picks it up without manual .env configuration.
#
# Requires: Stripe CLI (https://docs.stripe.com/stripe-cli)
# Gracefully skips Stripe forwarding if the CLI is not installed.

set -euo pipefail

cleanup() {
  kill 0 2>/dev/null || true
  rm -f "$STRIPE_OUTPUT" 2>/dev/null || true
}
trap cleanup EXIT

STRIPE_OUTPUT=$(mktemp)

if ! command -v stripe &>/dev/null; then
  echo "[dev] Stripe CLI not found — skipping webhook forwarding"
  echo "[dev] Install it to enable local webhooks: https://docs.stripe.com/stripe-cli"
  exec pnpm -r --parallel run dev
fi

# Start stripe listen, tee output to a temp file so we can extract the secret
stripe listen --forward-to http://localhost:3000/api/stripe/webhook 2>&1 \
  | tee "$STRIPE_OUTPUT" &

# Wait for the signing secret to appear (up to 30 seconds)
echo "[dev] Waiting for Stripe webhook secret..."
STRIPE_WEBHOOK_SECRET=""
for _ in $(seq 1 30); do
  if grep -q 'whsec_' "$STRIPE_OUTPUT" 2>/dev/null; then
    STRIPE_WEBHOOK_SECRET=$(grep -o 'whsec_[a-zA-Z0-9_]*' "$STRIPE_OUTPUT" | head -1)
    break
  fi
  sleep 1
done

if [ -z "$STRIPE_WEBHOOK_SECRET" ]; then
  echo "[dev] Warning: could not extract Stripe webhook secret after 30s"
else
  echo "[dev] Stripe webhook secret captured: ${STRIPE_WEBHOOK_SECRET:0:12}..."
  export STRIPE_WEBHOOK_SECRET
fi

# Start API, web, and email-viewer — STRIPE_WEBHOOK_SECRET is in the environment
# (Node's --env-file does not override existing env vars)
pnpm -r --parallel run dev

wait
