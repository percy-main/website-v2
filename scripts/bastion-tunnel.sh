#!/usr/bin/env bash
# bastion-tunnel.sh — Spin up a short-lived EC2 bastion, open an SSH tunnel
# to RDS, run data-lift, then tear everything down.
#
# Usage:
#   ./scripts/bastion-tunnel.sh --source libsql://your-db.turso.io --token <TURSO_TOKEN>
#
# Prerequisites:
#   - AWS CLI v2 configured (profile: percy-main)
#   - jq installed

set -euo pipefail

PROFILE="percy-main"
REGION="eu-west-2"
RDS_IDENTIFIER="percy-main-production-db"
RDS_SECRET_ID="percy-main-production/rds/credentials"
LOCAL_PORT=15432
INSTANCE_TYPE="t3.micro"   # x86_64, free-tier eligible
KEY_NAME="bastion-tmp-$$"
KEY_FILE="/tmp/${KEY_NAME}.pem"
BASTION_SG_NAME="bastion-tmp-$$"

# Track resources for cleanup
INSTANCE_ID=""
SG_ID=""
SG_RULE_ID=""

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
    # Retry a few times — SG deletion can lag behind instance termination
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
# Pass-through args for data-lift
# ---------------------------------------------------------------------------
LIFT_ARGS=("$@")

if [[ ${#LIFT_ARGS[@]} -eq 0 ]]; then
  echo "Usage: ./scripts/bastion-tunnel.sh --source <libsql://url> --token <token>"
  echo ""
  echo "All arguments are forwarded to data-lift.ts."
  echo "The --target flag is set automatically (tunnelled RDS connection)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Gather infrastructure info
# ---------------------------------------------------------------------------
echo "Gathering infrastructure info..."

# VPC ID
VPC_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=percy-main-production-vpc" \
  --query 'Vpcs[0].VpcId' --output text)
echo "  VPC: $VPC_ID"

# Public subnet (first one)
SUBNET_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=public" \
  --query 'Subnets[0].SubnetId' --output text)
echo "  Subnet: $SUBNET_ID"

# RDS endpoint
RDS_HOST=$(aws --profile "$PROFILE" --region "$REGION" rds describe-db-instances \
  --db-instance-identifier "$RDS_IDENTIFIER" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "  RDS host: $RDS_HOST"

# RDS security group
RDS_SG_ID=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=percy-main-production-rds-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)
echo "  RDS SG: $RDS_SG_ID"

# RDS credentials
RDS_CREDS=$(aws --profile "$PROFILE" --region "$REGION" secretsmanager get-secret-value \
  --secret-id "$RDS_SECRET_ID" --query 'SecretString' --output text)
RDS_USER=$(echo "$RDS_CREDS" | jq -r '.username')
RDS_PASS=$(echo "$RDS_CREDS" | jq -r '.password')
RDS_DBNAME=$(echo "$RDS_CREDS" | jq -r '.dbname')

# URL-encode the password (special chars break pg connection string parsing)
RDS_PASS_ENCODED=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" -- "$RDS_PASS")

# My public IP (for SSH SG rule)
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
  --description "Temporary bastion for data-lift" \
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

# Latest Amazon Linux 2023 AMI (x86_64)
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
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=bastion-data-lift-tmp}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "  Instance: $INSTANCE_ID"
echo "  Waiting for instance to be running..."
aws --profile "$PROFILE" --region "$REGION" ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID"

# Get public IP
BASTION_IP=$(aws --profile "$PROFILE" --region "$REGION" ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "  Bastion IP: $BASTION_IP"

# Wait for SSH to become available
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

# Check tunnel is up
if ! kill -0 $SSH_PID 2>/dev/null; then
  echo "ERROR: SSH tunnel failed to start"
  exit 1
fi
echo "  Tunnel PID: $SSH_PID"

# ---------------------------------------------------------------------------
# Build the target connection string and run data-lift
# ---------------------------------------------------------------------------
TARGET_URL="postgres://${RDS_USER}:${RDS_PASS_ENCODED}@localhost:${LOCAL_PORT}/${RDS_DBNAME}?sslmode=no-verify"

echo ""
echo "Running data-lift..."
echo "======================================"
pnpm run db:lift -- "${LIFT_ARGS[@]}" --target "$TARGET_URL"
echo "======================================"

# Kill SSH tunnel
kill $SSH_PID 2>/dev/null || true
wait $SSH_PID 2>/dev/null || true

echo ""
echo "Data lift complete. Cleaning up resources..."
