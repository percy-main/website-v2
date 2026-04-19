# EventBridge Scheduler Module
# Provisions a scheduled ECS task for the Play Cricket data sync.
# Runs on a cron schedule using EventBridge Scheduler with ECS RunTask.

# ------------------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------------------

variable "environment" {
  type        = string
  description = "Environment name"
}

variable "cluster_arn" {
  type        = string
  description = "ECS cluster ARN"
}

variable "task_definition_arn" {
  type        = string
  description = "ECS task definition ARN (family, not specific revision)"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets for the ECS task"
}

variable "security_group_id" {
  type        = string
  description = "Security group for the ECS task"
}

variable "task_execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN (for PassRole)"
}

variable "task_role_arn" {
  type        = string
  description = "ECS task role ARN (for PassRole)"
}

variable "assign_public_ip" {
  type        = bool
  default     = false
  description = "Whether to assign public IP to the task"
}

variable "alarms_sns_topic_arn" {
  type        = string
  description = "SNS topic ARN for DLQ + sync-failure alarms"
}

variable "log_group_name" {
  type        = string
  description = "CloudWatch log group name where the sync task writes (used for the failure metric filter)"
}

# ------------------------------------------------------------------------------
# Locals
# ------------------------------------------------------------------------------

locals {
  name_prefix = "percy-main-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = "percy-main"
    ManagedBy   = "terraform"
    Module      = "scheduling"
  }
}

# ------------------------------------------------------------------------------
# IAM — EventBridge Scheduler Execution Role
# ------------------------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "${local.name_prefix}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "scheduler_ecs" {
  name = "${local.name_prefix}-scheduler-ecs"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "${var.task_definition_arn}:*"
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          var.task_execution_role_arn,
          var.task_role_arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.scheduler_dlq.arn
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Dead-letter queue for EventBridge invocation failures
# (Catches RunTask invocation failures only — IAM, capacity, throttling.
# Does NOT catch tasks that started and exited non-zero. See the log metric
# filter below for that.)
# ------------------------------------------------------------------------------

resource "aws_sqs_queue" "scheduler_dlq" {
  name                      = "${local.name_prefix}-play-cricket-sync-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}

resource "aws_cloudwatch_metric_alarm" "scheduler_dlq_messages" {
  alarm_name          = "${local.name_prefix}-play-cricket-sync-dlq-messages"
  alarm_description   = "EventBridge failed to invoke the Play Cricket sync — message in DLQ"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.scheduler_dlq.name
  }

  alarm_actions = [var.alarms_sns_topic_arn]
  ok_actions    = [var.alarms_sns_topic_arn]

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Log metric filter — catch sync tasks that ran but exited non-zero
# (The DLQ above only catches invocation failures, not in-task crashes.)
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "sync_failed" {
  name           = "${local.name_prefix}-play-cricket-sync-failed"
  log_group_name = var.log_group_name
  pattern        = "\"Sync failed\""

  metric_transformation {
    name          = "PlayCricketSyncFailed"
    namespace     = "PercyMain/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "sync_failed" {
  alarm_name          = "${local.name_prefix}-play-cricket-sync-failed"
  alarm_description   = "Play Cricket sync task ran and exited non-zero"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.sync_failed.metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.sync_failed.metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alarms_sns_topic_arn]
  ok_actions    = [var.alarms_sns_topic_arn]

  tags = local.tags
}

# ------------------------------------------------------------------------------
# EventBridge Scheduler — Play Cricket Sync
# ------------------------------------------------------------------------------

resource "aws_scheduler_schedule" "play_cricket_sync" {
  name = "${var.environment}-play-cricket-sync"

  schedule_expression          = "cron(0 3 ? * SUN,MON,TUE *)"
  schedule_expression_timezone = "Europe/London"
  state                        = "ENABLED"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  target {
    arn      = var.cluster_arn
    role_arn = aws_iam_role.scheduler.arn

    dead_letter_config {
      arn = aws_sqs_queue.scheduler_dlq.arn
    }

    ecs_parameters {
      task_definition_arn = var.task_definition_arn
      launch_type         = "FARGATE"
      platform_version    = "LATEST"
      task_count          = 1

      network_configuration {
        subnets          = var.subnet_ids
        security_groups  = [var.security_group_id]
        assign_public_ip = var.assign_public_ip
      }
    }

    input = jsonencode({
      containerOverrides = [
        {
          name    = "api"
          command = ["node", "apps/api/dist/sync-runner.js"]
        }
      ]
    })
  }

}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------

output "schedule_arn" {
  description = "ARN of the Play Cricket sync EventBridge schedule"
  value       = aws_scheduler_schedule.play_cricket_sync.arn
}
