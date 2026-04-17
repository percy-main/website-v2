#!/usr/bin/env bash
# bastion-dump.sh — Spin up a short-lived EC2 bastion, open an SSH tunnel
# to RDS, run pg_dump, save to a local file, then tear everything down.
#
# Usage:
#   ./scripts/bastion-dump.sh
#   ./scripts/bastion-dump.sh --output dumps/custom-name.sql
#
# Output defaults to: dumps/prod-<timestamp>.sql
#
# Prerequisites:
#   - AWS CLI v2 configured (profile: percy-main)
#   - jq installed
#   - pg_dump installed (from postgresql client tools)

set -euo pipefail

PROFILE="percy-main"
REGION="eu-west-2"
RDS_IDENTIFIER="percy-main-production-db"
RDS_SECRET_ID="percy-main-production/rds/credentials"
LOCAL_PORT=15432
INSTANCE_TYPE="t3.micro"
KEY_NAME="bastion-tmp-$$"
KEY_FILE="/tmp/${KEY_NAME}.pem"
BASTION_SG_NAME="bastion-tmp-$$"

# Track resources for cleanup
INSTANCE_ID=""
SG_ID=""
SG_RULE_ID=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
DUMP_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o)
      DUMP_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/bastion-dump.sh [--output <path>]"
      exit 1
      ;;
  esac
done

if [[ -z "$DUMP_FILE" ]]; then
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  DUMP_FILE="dumps/prod-${TIMESTAMP}.sql"
fi

# Ensure dumps directory exists
mkdir -p "$(dirname "$DUMP_FILE")"

# ---------------------------------------------------------------------------
# Cleanup — always runs on exit
# ---------------------------------------------------------------------------
cleanup() {
  echo ""
  echo "Cleaning up..."

  if [[ -n "$INSTANCE_ID" ]]; then
    echo "  Terminating instance ${INSTANCE_ID}..."
    aws --profile "$PROFILE" --region "$REGION" ec2 terminate-instances \
      --instance-ids "$INSTANCE_ID" --output text > /dev/null 2>&1 || true
    echo "  Waiting for instance to terminate..."
    aws --profile "$PROFILE" --region "$REGION" ec2 wait instance-terminated \
      --instance-ids "$INSTANCE_ID" 2>/dev/null || true
  fi

  if [[ -n "$SG_RULE_ID" ]]; then
    echo "  Removing RDS ingress rule..."
    aws --profile "$PROFILE" --region "$REGION" ec2 revoke-security-group-ingress \
      --security-group-id "$RDS_SG_ID" \
      --security-group-rule-ids "$SG_RULE_ID" > /dev/null 2>&1 || true
  fi

  if [[ -n "$SG_ID" ]]; then
    echo "  Deleting bastion security group..."
    for i in 1 2 3 4 5; do
      aws --profile "$PROFILE" --region "$REGION" ec2 delete-security-group \
        --group-id "$SG_ID" 2>/dev/null && break
      sleep 5
    done
  fi

  if aws --profile "$PROFILE" --region "$REGION" ec2 describe-key-pairs \
    --key-names "$KEY_NAME" > /dev/null 2>&1; then
    echo "  Deleting key pair..."
    aws --profile "$PROFILE" --region "$REGION" ec2 delete-key-pair \
      --key-name "$KEY_NAME" > /dev/null 2>&1 || true
  fi

  rm -f "$KEY_FILE"
  echo "Done."
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Gather infrastructure info
# ---------------------------------------------------------------------------
echo "Gathering infrastructure info..."

VPC_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=percy-main-production-vpc" \
  --query 'Vpcs[0].VpcId' --output text)
echo "  VPC: $VPC_ID"

SUBNET_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=public" \
  --query 'Subnets[0].SubnetId' --output text)
echo "  Subnet: $SUBNET_ID"

RDS_HOST=$(aws --profile "$PROFILE" --region "$REGION" rds describe-db-instances \
  --db-instance-identifier "$RDS_IDENTIFIER" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "  RDS host: $RDS_HOST"

RDS_SG_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=percy-main-production-rds-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)
echo "  RDS SG: $RDS_SG_ID"

RDS_CREDS=$(aws --profile "$PROFILE" --region "$REGION" secretsmanager get-secret-value \
  --secret-id "$RDS_SECRET_ID" --query 'SecretString' --output text)
RDS_USER=$(echo "$RDS_CREDS" | jq -r '.username')
RDS_PASS=$(echo "$RDS_CREDS" | jq -r '.password')
RDS_DBNAME=$(echo "$RDS_CREDS" | jq -r '.dbname')

MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "  Your IP: $MY_IP"

# ---------------------------------------------------------------------------
# Create temporary key pair
# ---------------------------------------------------------------------------
echo ""
echo "Creating temporary key pair..."
aws --profile "$PROFILE" --region "$REGION" ec2 create-key-pair \
  --key-name "$KEY_NAME" \
  --query 'KeyMaterial' --output text > "$KEY_FILE"
chmod 400 "$KEY_FILE"

# ---------------------------------------------------------------------------
# Create bastion security group (SSH from my IP only)
# ---------------------------------------------------------------------------
echo "Creating bastion security group..."
SG_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 create-security-group \
  --group-name "$BASTION_SG_NAME" \
  --description "Temporary bastion for pg_dump" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)

aws --profile "$PROFILE" --region "$REGION" ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp --port 22 \
  --cidr "${MY_IP}/32" > /dev/null

echo "  Bastion SG: $SG_ID"

# ---------------------------------------------------------------------------
# Allow bastion SG → RDS SG on port 5432
# ---------------------------------------------------------------------------
echo "Adding bastion → RDS ingress rule..."
SG_RULE_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 authorize-security-group-ingress \
  --group-id "$RDS_SG_ID" \
  --protocol tcp --port 5432 \
  --source-group "$SG_ID" \
  --query 'SecurityGroupRules[0].SecurityGroupRuleId' --output text)

# ---------------------------------------------------------------------------
# Launch bastion instance
# ---------------------------------------------------------------------------
echo "Launching bastion instance..."

AMI_ID=$(aws --profile "$PROFILE" --region "$REGION" ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

INSTANCE_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --subnet-id "$SUBNET_ID" \
  --associate-public-ip-address \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=bastion-dump-tmp}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "  Instance: $INSTANCE_ID"
echo "  Waiting for instance to be running..."
aws --profile "$PROFILE" --region "$REGION" ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID"

BASTION_IP=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "  Bastion IP: $BASTION_IP"

echo "  Waiting for SSH..."
for i in $(seq 1 30); do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes \
    -i "$KEY_FILE" ec2-user@"$BASTION_IP" true 2>/dev/null; then
    break
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# Open SSH tunnel in background
# ---------------------------------------------------------------------------
echo ""
echo "Opening SSH tunnel (localhost:${LOCAL_PORT} → ${RDS_HOST}:5432)..."
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60 \
  -i "$KEY_FILE" -N -L "${LOCAL_PORT}:${RDS_HOST}:5432" \
  ec2-user@"$BASTION_IP" &
SSH_PID=$!
sleep 2

if ! kill -0 $SSH_PID 2>/dev/null; then
  echo "ERROR: SSH tunnel failed to start"
  exit 1
fi
echo "  Tunnel PID: $SSH_PID"

# ---------------------------------------------------------------------------
# Run pg_dump
# ---------------------------------------------------------------------------
echo ""
echo "Running pg_dump..."
echo "======================================"
PGPASSWORD="$RDS_PASS" pg_dump \
  -h localhost -p "$LOCAL_PORT" -U "$RDS_USER" -d "$RDS_DBNAME" \
  --no-owner --no-privileges --no-comments \
  --clean --if-exists \
  -f "$DUMP_FILE"
echo "======================================"

# Kill SSH tunnel
kill $SSH_PID 2>/dev/null || true
wait $SSH_PID 2>/dev/null || true

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo ""
echo "Dump saved to: $DUMP_FILE ($DUMP_SIZE)"
echo "Restore with:  ./scripts/db-restore.sh $DUMP_FILE"
