#!/usr/bin/env bash
# db-tunnel.sh - Start the on-demand Tailscale subnet router for prod DB
# access. The router self-stops 30 minutes after boot (issue #720); for a
# longer session, wait for the stop and run this again.
#
# Usage:
#   pnpm run db:tunnel
#
# Prerequisites:
#   - AWS CLI v2 configured (profile: percy-main)
#   - Tailscale up on your laptop (see docs/adrs/012-prod-db-access.md)

set -euo pipefail

PROFILE="percy-main"
REGION="eu-west-2"
ROUTER_NAME_TAG="percy-main-production-tailscale-router"

# Look up by Name tag rather than a hardcoded instance id - the instance is
# replaced whenever its user_data or AMI changes.
read -r INSTANCE_ID STATE < <(aws --profile "$PROFILE" --region "$REGION" \
  ec2 describe-instances \
  --filters "Name=tag:Name,Values=${ROUTER_NAME_TAG}" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' \
  --output text)

if [[ -z "${INSTANCE_ID:-}" || "$INSTANCE_ID" == "None" ]]; then
  echo "ERROR: no instance found with tag Name=${ROUTER_NAME_TAG}" >&2
  exit 1
fi

echo "Router instance: ${INSTANCE_ID} (${STATE})"

case "$STATE" in
running)
  echo "Router already up - it self-stops 30 minutes after it last booted."
  exit 0
  ;;
pending)
  echo "Router already starting..."
  ;;
stopping)
  echo "Router is stopping - waiting for it to finish before restarting..."
  aws --profile "$PROFILE" --region "$REGION" ec2 wait instance-stopped \
    --instance-ids "$INSTANCE_ID"
  aws --profile "$PROFILE" --region "$REGION" ec2 start-instances \
    --instance-ids "$INSTANCE_ID" --output text > /dev/null
  ;;
stopped)
  echo "Starting router..."
  aws --profile "$PROFILE" --region "$REGION" ec2 start-instances \
    --instance-ids "$INSTANCE_ID" --output text > /dev/null
  ;;
esac

aws --profile "$PROFILE" --region "$REGION" ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID"

echo ""
echo "Router up - it self-stops in 30 minutes."
echo "Give Tailscale ~1 minute to connect, then use psql/TablePlus against RDS"
echo "as usual (connection details: docs/adrs/012-prod-db-access.md)."
