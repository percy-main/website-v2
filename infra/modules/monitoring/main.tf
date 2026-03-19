# Monitoring Module
# Provisions SNS topics, CloudWatch alarms, and a CloudWatch dashboard
# for ECS, ALB, and RDS monitoring.

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  type = string
}

variable "alarm_email" {
  type    = string
  default = ""
}

variable "cluster_name" {
  type        = string
  description = "ECS cluster name for metrics"
}

variable "service_name" {
  type        = string
  description = "ECS service name for metrics"
}

variable "alb_arn_suffix" {
  type        = string
  description = "ALB ARN suffix for metrics"
}

variable "target_group_arn_suffix" {
  type        = string
  description = "Target group ARN suffix for metrics"
}

variable "rds_instance_id" {
  type        = string
  description = "RDS instance identifier for metrics"
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

data "aws_region" "current" {}

locals {
  prefix = "percy-main-${var.environment}"

  default_tags = {
    Environment = var.environment
    Module      = "monitoring"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# SNS Topic for Alarm Notifications
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name              = "${local.prefix}-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.default_tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# -----------------------------------------------------------------------------
# ECS CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${local.prefix}-ecs-cpu-high"
  alarm_description   = "ECS CPU utilization exceeds 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.service_name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  alarm_name          = "${local.prefix}-ecs-memory-high"
  alarm_description   = "ECS memory utilization exceeds 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.service_name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# -----------------------------------------------------------------------------
# ALB CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  alarm_name          = "${local.prefix}-alb-5xx-errors"
  alarm_description   = "ALB 5xx error count exceeds 10"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  alarm_name          = "${local.prefix}-alb-unhealthy-hosts"
  alarm_description   = "ALB has unhealthy targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_latency_high" {
  alarm_name          = "${local.prefix}-alb-latency-high"
  alarm_description   = "ALB p99 response time exceeds 2 seconds"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# -----------------------------------------------------------------------------
# RDS CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization exceeds 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  alarm_name          = "${local.prefix}-rds-free-storage-low"
  alarm_description   = "RDS free storage space below 2 GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 2000000000 # 2 GB in bytes
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${local.prefix}-rds-connections-high"
  alarm_description   = "RDS database connections exceed 60 (~70% of db.t4g.micro limit)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 60
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# -----------------------------------------------------------------------------
# CloudWatch Dashboard
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "ECS CPU Utilization"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.service_name]
          ]
          period = 300
          stat   = "Average"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "ECS Memory Utilization"
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", var.service_name]
          ]
          period = 300
          stat   = "Average"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "ALB Request Count"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix]
          ]
          period = 300
          stat   = "Sum"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "ALB 5xx Errors"
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", var.alb_arn_suffix]
          ]
          period = 300
          stat   = "Sum"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 8
        height = 6
        properties = {
          title = "RDS CPU Utilization"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id]
          ]
          period = 300
          stat   = "Average"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          title = "RDS Database Connections"
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_id]
          ]
          period = 300
          stat   = "Average"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 12
        width  = 8
        height = 6
        properties = {
          title = "RDS Free Storage Space (Bytes)"
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_instance_id]
          ]
          period = 300
          stat   = "Average"
          region = "${data.aws_region.current.name}"
          view   = "timeSeries"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "sns_topic_arn" {
  description = "ARN of the SNS topic for alarm notifications"
  value       = aws_sns_topic.alarms.arn
}
