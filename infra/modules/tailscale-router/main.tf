# Tailscale Subnet Router Module
#
# Provisions a minimal EC2 instance running tailscaled as a subnet router,
# advertising the VPC CIDR so admins on the tailnet can reach private
# resources (notably RDS) from their laptops.
#
# Design notes:
#   - Sits in a public subnet because the environment has no NAT gateway.
#     Outbound internet is needed for the Tailscale control plane.
#   - Zero inbound rules — tailscaled is outbound-initiated; peer traffic
#     arrives via NAT-traversed UDP.
#   - No SSH. If debugging is ever needed, `aws ssm start-session` via the
#     SSM agent installed by user_data.
#   - OAuth client secret (a `tskey-client-...` reusable auth key minted by
#     an OAuth client scoped to `tag:subnet-router`) is created in Secrets
#     Manager here as an empty resource. The value is populated manually
#     after first apply — see docs/adrs/NNNN-prod-db-access.md.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  type        = string
  description = "Environment name (production, staging)"
}

variable "vpc_id" {
  type        = string
  description = "VPC to deploy the router into"
}

variable "public_subnet_id" {
  type        = string
  description = "Public subnet for the router (needs IGW egress — no NAT in this env)"
}

variable "advertise_cidr" {
  type        = string
  description = "CIDR block to advertise to the tailnet (typically the VPC CIDR)"
}

variable "instance_type" {
  type        = string
  default     = "t4g.nano"
  description = "EC2 instance type (ARM/Graviton recommended for cost)"
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  name_prefix = "percy-main-${var.environment}"

  common_tags = {
    Environment = var.environment
    Project     = "percy-main"
    ManagedBy   = "terraform"
    Module      = "tailscale-router"
  }
}

# -----------------------------------------------------------------------------
# OAuth Client Secret (value populated manually post-apply)
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "tailscale_auth" {
  name        = "${local.name_prefix}/tailscale/auth-key"
  description = "Tailscale OAuth client secret (tskey-client-...) for ${local.name_prefix} subnet router"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-tailscale-auth-key"
  })
}

# -----------------------------------------------------------------------------
# Security Group — ZERO inbound, unrestricted egress
# -----------------------------------------------------------------------------

resource "aws_security_group" "router" {
  name        = "${local.name_prefix}-tailscale-router-sg"
  description = "Tailscale subnet router — no inbound, outbound-only to control plane + peers"
  vpc_id      = var.vpc_id

  # Deliberately no ingress rules. tailscaled initiates all connections
  # outbound; peer traffic arrives via NAT-traversed UDP on ephemeral ports
  # which the SG stateful tracking handles.

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-tailscale-router-sg"
  })
}

resource "aws_security_group_rule" "router_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.router.id
  description       = "All outbound (Tailscale control plane, DERP, peer WireGuard, OS updates)"
}

# -----------------------------------------------------------------------------
# IAM — read OAuth secret + SSM agent for break-glass
# -----------------------------------------------------------------------------

resource "aws_iam_role" "router" {
  name = "${local.name_prefix}-tailscale-router"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.router.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "read_tailscale_secret" {
  name = "read-tailscale-secret"
  role = aws_iam_role.router.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.tailscale_auth.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "router" {
  name = "${local.name_prefix}-tailscale-router"
  role = aws_iam_role.router.name
}

# -----------------------------------------------------------------------------
# AMI — latest Amazon Linux 2023 ARM
# -----------------------------------------------------------------------------

data "aws_ssm_parameter" "al2023_arm" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# -----------------------------------------------------------------------------
# User Data — install tailscaled, enable IP forwarding, authenticate
# -----------------------------------------------------------------------------

locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    # SSM agent is preinstalled on AL2023 but ensure it's running
    systemctl enable --now amazon-ssm-agent

    # IP forwarding — required for subnet router
    cat > /etc/sysctl.d/99-tailscale.conf <<'SYSCTL'
    net.ipv4.ip_forward = 1
    net.ipv6.conf.all.forwarding = 1
    SYSCTL
    sysctl --system

    # Install Tailscale (aws CLI v2 is preinstalled on AL2023)
    curl -fsSL https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo \
      -o /etc/yum.repos.d/tailscale.repo
    dnf install -y tailscale
    systemctl enable --now tailscaled

    # Systemd oneshot that fetches the auth key and runs `tailscale up`.
    # Retries on failure (e.g. secret not yet populated). Survives reboots.
    cat > /usr/local/bin/tailscale-authenticate.sh <<'AUTH'
    #!/bin/bash
    set -euo pipefail
    AUTH_KEY=$(aws secretsmanager get-secret-value \
      --secret-id "${aws_secretsmanager_secret.tailscale_auth.name}" \
      --region "${data.aws_region.current.name}" \
      --query SecretString --output text)
    if [[ -z "$AUTH_KEY" || "$AUTH_KEY" == "null" ]]; then
      echo "Tailscale auth secret is empty — populate it manually." >&2
      exit 1
    fi
    tailscale up \
      --authkey="$AUTH_KEY" \
      --advertise-routes="${var.advertise_cidr}" \
      --accept-dns=false \
      --hostname="${local.name_prefix}-router" \
      --advertise-tags=tag:subnet-router
    AUTH
    chmod +x /usr/local/bin/tailscale-authenticate.sh

    cat > /etc/systemd/system/tailscale-authenticate.service <<'UNIT'
    [Unit]
    Description=Authenticate Tailscale subnet router
    After=tailscaled.service network-online.target
    Wants=network-online.target
    Requires=tailscaled.service

    [Service]
    Type=oneshot
    ExecStart=/usr/local/bin/tailscale-authenticate.sh
    RemainAfterExit=yes
    Restart=on-failure
    RestartSec=30

    [Install]
    WantedBy=multi-user.target
    UNIT
    systemctl daemon-reload
    systemctl enable --now tailscale-authenticate.service
  EOT
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# EC2 Instance
# -----------------------------------------------------------------------------

resource "aws_instance" "router" {
  ami                    = data.aws_ssm_parameter.al2023_arm.value
  instance_type          = var.instance_type
  subnet_id              = var.public_subnet_id
  vpc_security_group_ids = [aws_security_group.router.id]
  iam_instance_profile   = aws_iam_instance_profile.router.name

  # Subnet router must forward traffic destined for other hosts
  source_dest_check = false

  # IMDSv2 required — blocks SSRF-style credential theft
  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  user_data                   = local.user_data
  user_data_replace_on_change = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-tailscale-router"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "security_group_id" {
  description = "Security group ID for the router — grant inbound to private resources from this SG"
  value       = aws_security_group.router.id
}

output "instance_id" {
  description = "EC2 instance ID (for SSM session-manager break-glass)"
  value       = aws_instance.router.id
}

output "auth_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Tailscale OAuth client secret"
  value       = aws_secretsmanager_secret.tailscale_auth.arn
}

output "auth_secret_name" {
  description = "Name of the Secrets Manager secret (for aws CLI put-secret-value)"
  value       = aws_secretsmanager_secret.tailscale_auth.name
}
