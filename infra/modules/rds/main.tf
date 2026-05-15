# RDS PostgreSQL Module
# Provisions a PostgreSQL 16 instance with parameter group, subnet group,
# and Secrets Manager credential storage.

terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
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
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "max_allocated_storage" {
  type        = number
  default     = 50
  description = "Maximum storage for auto-scaling (0 to disable)"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "enable_event_subscription" {
  type        = bool
  default     = false
  description = "Create a dedicated SNS topic + event subscription for RDS events (backup failures, maintenance, low storage). Operators subscribe to the topic out of band."
}

variable "master_secret_break_glass_principal_arns" {
  type        = list(string)
  default     = []
  description = "When non-empty, attach a resource policy to the RDS master credentials secret that denies GetSecretValue from any principal not in this list. Used to make the master credentials break-glass-only once app_rw + app_ddl take over runtime + migration (#130). Leave empty to keep the existing permissive IAM-only access. Both IAM-attached perms AND a matching principal here are required to read."
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
    Module      = "rds"
  }
}

# -----------------------------------------------------------------------------
# Password Generation
# -----------------------------------------------------------------------------

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}|:?"

  lifecycle {
    ignore_changes = all
  }
}

# Application role passwords (#130 — principle of least privilege).
# Alphanumeric only — these get embedded in DATABASE_URL strings and
# we want to avoid URL-encoding round-trips. 32 chars × 62-symbol
# alphabet ≈ 190 bits of entropy, well above what RDS needs.
#
# The roles themselves are created NOLOGIN by the role-split migration;
# operators set LOGIN + the password from these secrets via psql over
# Tailscale once after first apply. See docs/adrs/ for the bootstrap
# runbook. After that, the roles' passwords live in Postgres itself.
resource "random_password" "app_rw" {
  length  = 32
  special = false

  lifecycle {
    ignore_changes = all
  }
}

resource "random_password" "app_ddl" {
  length  = 32
  special = false

  lifecycle {
    ignore_changes = all
  }
}

# -----------------------------------------------------------------------------
# DB Subnet Group
# -----------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = var.private_subnet_ids

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-subnet-group"
  })
}

# -----------------------------------------------------------------------------
# Parameter Group (PostgreSQL 16)
# -----------------------------------------------------------------------------

resource "aws_db_parameter_group" "main" {
  name   = "${local.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pg16-params"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# RDS Instance
# -----------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-db"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage > 0 ? var.max_allocated_storage : null
  storage_encrypted     = true

  db_name  = "percy_main"
  username = "percy"
  password = random_password.db.result

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  parameter_group_name   = aws_db_parameter_group.main.name
  vpc_security_group_ids = [var.security_group_id]

  publicly_accessible = false
  # Pinned to 1 day by AWS Free Plan: ModifyDBInstance returns
  # FreeTierRestrictionError when retention > 1. Apply with retention
  # = 7 (#216 / ADR 041) failed in production on 2026-05-09.
  # Revisit this when the account moves off the Free Plan; the desired
  # value is 7 (working week of recovery points). The DB event
  # subscription added in #216 is in place, so a missed/failed backup
  # at least surfaces via SNS now.
  backup_retention_period = 1
  backup_window           = "02:00-03:00"
  maintenance_window      = "mon:03:00-mon:04:00"

  deletion_protection = var.environment == "production"

  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  # Export postgresql + upgrade logs to CloudWatch so they're reachable
  # for alarming and downstream NR forwarding (#200). The parameter
  # group already enables log_min_duration_statement / log_connections
  # / log_disconnections — without exports those logs never leave the
  # instance.
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Enhanced monitoring — 60s OS-level metrics (load avg, IOPS by
  # process, network). Performance Insights covers query-level; this
  # covers the host. Valid intervals: 1/5/10/15/30/60.
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_enhanced_monitoring.arn

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name_prefix}-db-final" : null

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db"
  })
}

# -----------------------------------------------------------------------------
# Enhanced Monitoring IAM role
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "rds_em_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_enhanced_monitoring" {
  name               = "${local.name_prefix}-rds-enhanced-monitoring"
  assume_role_policy = data.aws_iam_policy_document.rds_em_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# -----------------------------------------------------------------------------
# CloudWatch log groups for RDS log exports — explicit so we can control
# retention. RDS would otherwise create them with infinite retention.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "rds_postgres" {
  name              = "/aws/rds/instance/${local.name_prefix}-db/postgresql"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "rds_upgrade" {
  name              = "/aws/rds/instance/${local.name_prefix}-db/upgrade"
  retention_in_days = 30
  tags              = local.common_tags
}

# -----------------------------------------------------------------------------
# Secrets Manager — Store DB Credentials
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${local.name_prefix}/rds/credentials"
  description = "RDS credentials for ${local.name_prefix}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-credentials"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })

  # Master rotation (#130 ADR 043 step 5) is operator-driven via
  # `aws secretsmanager put-secret-value`. Without this, the next TF
  # apply would revert the rotation back to the original
  # random_password.db.result.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Break-glass-only access to the master credentials secret. Active once
# app_rw + app_ddl have taken over the runtime + migration paths
# (#130). Without this, the existing IAM-only allow on `*percy-main*`
# means any role with that policy can still read the master — which
# defeats the role split. The deny here applies to all principals NOT
# in the allowlist, so the task-execution role can no longer fetch
# master credentials even though its IAM policy still allows it.
resource "aws_secretsmanager_secret_policy" "db_credentials_break_glass" {
  count = length(var.master_secret_break_glass_principal_arns) > 0 ? 1 : 0

  secret_arn = aws_secretsmanager_secret.db_credentials.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyAllExceptBreakGlass"
        Effect    = "Deny"
        Principal = "*"
        Action    = "secretsmanager:GetSecretValue"
        Resource  = "*"
        Condition = {
          ArnNotEquals = {
            "aws:PrincipalArn" = var.master_secret_break_glass_principal_arns
          }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Secrets Manager — app_rw and app_ddl credentials (#130)
# Each secret stores the JSON shape Postgres clients need plus a
# pre-built DATABASE_URL so the ECS task definition can reference a
# single JSON key (`...:DATABASE_URL::`) directly, avoiding URL
# assembly in app code.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "db_credentials_app_rw" {
  name        = "${local.name_prefix}/rds/app_rw"
  description = "App runtime (CRUD only) credentials for ${local.name_prefix}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-credentials-app-rw"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials_app_rw" {
  secret_id = aws_secretsmanager_secret.db_credentials_app_rw.id

  secret_string = jsonencode({
    username     = "app_rw"
    password     = random_password.app_rw.result
    host         = aws_db_instance.main.address
    port         = aws_db_instance.main.port
    dbname       = aws_db_instance.main.db_name
    DATABASE_URL = "postgres://app_rw:${random_password.app_rw.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  })
}

resource "aws_secretsmanager_secret" "db_credentials_app_ddl" {
  name        = "${local.name_prefix}/rds/app_ddl"
  description = "Migration runner (DDL) credentials for ${local.name_prefix}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-credentials-app-ddl"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials_app_ddl" {
  secret_id = aws_secretsmanager_secret.db_credentials_app_ddl.id

  secret_string = jsonencode({
    username     = "app_ddl"
    password     = random_password.app_ddl.result
    host         = aws_db_instance.main.address
    port         = aws_db_instance.main.port
    dbname       = aws_db_instance.main.db_name
    DATABASE_URL = "postgres://app_ddl:${random_password.app_ddl.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "endpoint" {
  description = "RDS instance endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "port" {
  description = "RDS instance port"
  value       = 5432
}

output "database_name" {
  description = "Name of the database"
  value       = "percy_main"
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret storing DB credentials"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "app_rw_secret_arn" {
  description = "ARN of the Secrets Manager secret storing app_rw (CRUD runtime) credentials"
  value       = aws_secretsmanager_secret.db_credentials_app_rw.arn
}

output "app_ddl_secret_arn" {
  description = "ARN of the Secrets Manager secret storing app_ddl (migration) credentials"
  value       = aws_secretsmanager_secret.db_credentials_app_ddl.arn
}

output "instance_id" {
  description = "RDS instance identifier (for monitoring)"
  value       = aws_db_instance.main.identifier
}

# -----------------------------------------------------------------------------
# Event subscription — surface backup / failure / maintenance events to SNS
# so a missed backup or hardware fault routes to on-call instead of being
# discovered next time someone tries to recover.
#
# A dedicated topic (separate from the monitoring module's alarms topic)
# avoids a module dependency cycle: monitoring needs rds.instance_id,
# so rds cannot also depend on monitoring.sns_topic_arn. Operators
# subscribe to this topic out of band.
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "db_events" {
  count = var.enable_event_subscription ? 1 : 0
  name  = "${local.name_prefix}-db-events"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-events"
  })
}

resource "aws_db_event_subscription" "main" {
  count = var.enable_event_subscription ? 1 : 0

  name      = "${local.name_prefix}-db-events"
  sns_topic = aws_sns_topic.db_events[0].arn

  source_type = "db-instance"
  source_ids  = [aws_db_instance.main.identifier]

  event_categories = [
    "backup",
    "failure",
    "failover",
    "low storage",
    "maintenance",
    "notification",
  ]

  tags = local.common_tags
}
