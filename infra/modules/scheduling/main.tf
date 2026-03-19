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
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# EventBridge Scheduler — Play Cricket Sync
# ------------------------------------------------------------------------------

resource "aws_scheduler_schedule" "play_cricket_sync" {
  name = "${var.environment}-play-cricket-sync"

  schedule_expression          = "cron(0 3 ? * SUN,FRI *)"
  schedule_expression_timezone = "Europe/London"
  state                        = "ENABLED"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  target {
    arn      = var.cluster_arn
    role_arn = aws_iam_role.scheduler.arn

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

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------

output "schedule_arn" {
  description = "ARN of the Play Cricket sync EventBridge schedule"
  value       = aws_scheduler_schedule.play_cricket_sync.arn
}
