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

variable "rds_max_allocated_storage_bytes" {
  type        = number
  default     = 0
  description = "RDS storage auto-scaling cap in bytes (env passes max_allocated_storage * 1024^3). When non-zero, the storage alarm uses a percentage threshold against this; when zero, falls back to the absolute 2GB threshold."
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
# Intentionally NOT encrypted with `alias/aws/sns`: CloudWatch alarm
# publishes need a CMK whose policy allows `cloudwatch.amazonaws.com`,
# and the AWS-managed SNS KMS key cannot have its policy edited. Alarm
# payloads carry CloudWatch alarm state metadata (no secrets), so
# leaving encryption-at-rest off is an acceptable trade. Add a CMK
# here if the threat model later requires it.

resource "aws_sns_topic" "alarms" {
  name = "${local.prefix}-alarms"
  tags = local.default_tags
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

# Running below desired — pages on task crash-loop / cold-stop / 0
# tasks running. Uses metric math so it works for any desired count.
resource "aws_cloudwatch_metric_alarm" "ecs_running_below_desired" {
  alarm_name          = "${local.prefix}-ecs-running-below-desired"
  alarm_description   = "ECS service has fewer running tasks than desired — crash loop, capacity exhaustion, or stuck deployment"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 0
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "missing"
    expression  = "desired - running"
    label       = "Desired - Running"
    return_data = true
  }

  metric_query {
    id = "desired"
    metric {
      metric_name = "DesiredTaskCount"
      namespace   = "ECS/ContainerInsights"
      period      = 60
      stat        = "Average"
      dimensions = {
        ClusterName = var.cluster_name
        ServiceName = var.service_name
      }
    }
  }

  metric_query {
    id = "running"
    metric {
      metric_name = "RunningTaskCount"
      namespace   = "ECS/ContainerInsights"
      period      = 60
      stat        = "Average"
      dimensions = {
        ClusterName = var.cluster_name
        ServiceName = var.service_name
      }
    }
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# Deployment failed (circuit-breaker rollback or other deployment-state
# failure) — routed to SNS via EventBridge.
resource "aws_cloudwatch_event_rule" "ecs_deployment_failed" {
  name        = "${local.prefix}-ecs-deployment-failed"
  description = "ECS service deployment entered a failed state (deployment circuit breaker, etc)"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Deployment State Change"]
    detail = {
      eventName = ["SERVICE_DEPLOYMENT_FAILED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_deployment_failed_to_sns" {
  rule      = aws_cloudwatch_event_rule.ecs_deployment_failed.name
  target_id = "sns"
  arn       = aws_sns_topic.alarms.arn
}

# Allow EventBridge to publish to the alarms SNS topic.
data "aws_iam_policy_document" "alarms_topic" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "cloudwatch.amazonaws.com"]
    }
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alarms.arn]
  }
}

resource "aws_sns_topic_policy" "alarms" {
  arn    = aws_sns_topic.alarms.arn
  policy = data.aws_iam_policy_document.alarms_topic.json
}

# -----------------------------------------------------------------------------
# ALB CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  alarm_name          = "${local.prefix}-alb-5xx-errors"
  alarm_description   = "ALB 5xx error count exceeds 10 (failures inside the LB — timeout to target etc)"
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

# Application-emitted 5xx — distinct from ELB 5xx above. A runtime
# 500 storm in the API would not trip the ELB-side alarm.
resource "aws_cloudwatch_metric_alarm" "alb_target_5xx_errors" {
  alarm_name          = "${local.prefix}-alb-target-5xx-errors"
  alarm_description   = "Target 5xx count >5 in 5min — API is emitting 500s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# Connection saturation — production runs 1 task by default; rejected
# connections are an early signal that the task is overloaded.
resource "aws_cloudwatch_metric_alarm" "alb_rejected_connections" {
  alarm_name          = "${local.prefix}-alb-rejected-connections"
  alarm_description   = "ALB rejected any connections — connection saturation"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RejectedConnectionCount"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_target_connection_errors" {
  alarm_name          = "${local.prefix}-alb-target-connection-errors"
  alarm_description   = "ALB target connection errors >5 in 5min — TCP-level errors hitting the ECS task"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "TargetConnectionErrorCount"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
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
  # When max_allocated_storage_bytes is provided, alarm at <15% free
  # against the auto-scaling cap (so the alarm tracks autoscale events
  # instead of firing too late after one). Falls back to the absolute
  # 2 GB threshold when caller doesn't pass the cap.
  alarm_name          = "${local.prefix}-rds-free-storage-low"
  alarm_description   = var.rds_max_allocated_storage_bytes > 0 ? "RDS free storage <15% of max_allocated_storage" : "RDS free storage space below 2 GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  threshold           = var.rds_max_allocated_storage_bytes > 0 ? 15 : 2000000000
  treat_missing_data  = "notBreaching"

  dynamic "metric_query" {
    for_each = var.rds_max_allocated_storage_bytes > 0 ? [1] : []
    content {
      id          = "free_pct"
      expression  = "(free_bytes / ${var.rds_max_allocated_storage_bytes}) * 100"
      label       = "FreeStorage % of max_allocated_storage"
      return_data = true
    }
  }

  dynamic "metric_query" {
    for_each = var.rds_max_allocated_storage_bytes > 0 ? [1] : []
    content {
      id = "free_bytes"
      metric {
        metric_name = "FreeStorageSpace"
        namespace   = "AWS/RDS"
        period      = 300
        stat        = "Average"
        dimensions = {
          DBInstanceIdentifier = var.rds_instance_id
        }
      }
    }
  }

  # Fallback: simple absolute-bytes alarm if no cap was passed in.
  metric_name = var.rds_max_allocated_storage_bytes > 0 ? null : "FreeStorageSpace"
  namespace   = var.rds_max_allocated_storage_bytes > 0 ? null : "AWS/RDS"
  period      = var.rds_max_allocated_storage_bytes > 0 ? null : 300
  statistic   = var.rds_max_allocated_storage_bytes > 0 ? null : "Average"
  dimensions = var.rds_max_allocated_storage_bytes > 0 ? null : {
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

# db.t4g.micro has 1 GiB RAM. <100 MiB freeable is the most common
# silent failure mode — connection refusal under load.
resource "aws_cloudwatch_metric_alarm" "rds_freeable_memory_low" {
  alarm_name          = "${local.prefix}-rds-freeable-memory-low"
  alarm_description   = "RDS freeable memory <100 MiB — instance under memory pressure, may refuse connections"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 100 * 1024 * 1024
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

# db.t4g.* are burstable — running out of CPU credits silently
# throttles compute to baseline (10% of vCPU on t4g.micro). The
# correct CW metric is CPUCreditBalance (the t-class CPU credit pool);
# `BurstBalance` exists in the AWS/RDS namespace too but tracks gp2
# *storage* burst credits, a different failure mode.
resource "aws_cloudwatch_metric_alarm" "rds_cpu_credit_balance_low" {
  alarm_name          = "${local.prefix}-rds-cpu-credit-balance-low"
  alarm_description   = "RDS CPUCreditBalance <30 — instance about to throttle CPU to baseline performance"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUCreditBalance"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 30
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_read_latency_p99_high" {
  alarm_name          = "${local.prefix}-rds-read-latency-p99-high"
  alarm_description   = "RDS ReadLatency p99 >50ms — slow reads, possible IOPS exhaustion or lock contention"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "ReadLatency"
  namespace           = "AWS/RDS"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 0.05
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_write_latency_p99_high" {
  alarm_name          = "${local.prefix}-rds-write-latency-p99-high"
  alarm_description   = "RDS WriteLatency p99 >50ms — slow writes, possible IOPS exhaustion or WAL backpressure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "WriteLatency"
  namespace           = "AWS/RDS"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 0.05
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_deadlocks" {
  alarm_name          = "${local.prefix}-rds-deadlocks"
  alarm_description   = "RDS Deadlocks >0 — concurrent transactions deadlocked, application logic likely needs review"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Deadlocks"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
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
