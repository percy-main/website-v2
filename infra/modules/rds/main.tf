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
  # 7 days gives us a working week of recovery points; combined with
  # multi_az = false (single AZ) this is the minimum viable RDS
  # backup posture. A missed weekend backup no longer leaves nothing
  # on Monday morning.
  backup_retention_period = 7
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
