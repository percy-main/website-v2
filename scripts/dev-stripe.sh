#!/usr/bin/env bash
# Forward Stripe webhooks to the local API server.
# Requires the Stripe CLI: https://docs.stripe.com/stripe-cli
#
# The CLI prints a webhook signing secret on startup (whsec_...).
# Set STRIPE_WEBHOOK_SECRET in apps/api/.env to that value.

set -euo pipefail

if ! command -v stripe &>/dev/null; then
  echo "[dev:stripe] Stripe CLI not found — skipping webhook forwarding."
  echo "[dev:stripe] Install it to enable local webhooks: https://docs.stripe.com/stripe-cli"
  exit 0
fi

echo "[dev:stripe] Starting Stripe webhook forwarding → http://localhost:3000/api/stripe/webhook"
exec stripe listen --forward-to http://localhost:3000/api/stripe/webhook
