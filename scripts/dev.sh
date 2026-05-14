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

# ── AWS percy-main creds for Scout face detection ─────────────────────────
# Scout's recognition-source pipeline calls AWS Rekognition (DetectFaces) on
# candidate images. Local dev runs S3 against Localstack (S3_ENDPOINT), but
# Rekognition has no Localstack equivalent — it has to hit real AWS.
#
# Validate the percy-main profile up front so the API process inherits a
# working AWS_PROFILE and face detection works on the first request rather
# than latching off after a credentials-class error. Non-fatal: if creds
# aren't valid we just print a clear message and proceed — face detection
# degrades to no-op (the API will still run everything else).
if command -v aws &>/dev/null; then
  if aws sts get-caller-identity --profile percy-main &>/dev/null; then
    export AWS_PROFILE=percy-main
    echo "[dev] AWS percy-main authenticated — Scout face detection enabled"
  else
    echo "[dev] AWS percy-main profile not authenticated — face detection disabled this session."
    echo "[dev]   SSO profile:    aws sso login --profile percy-main"
    echo "[dev]   Static creds:   check ~/.aws/credentials [percy-main]"
    echo "[dev] Fix and re-run pnpm dev to enable face detection."
  fi
else
  echo "[dev] AWS CLI not found — Scout face detection disabled. Install AWS CLI v2."
fi

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
