# ECS Fargate Service Module
# Provisions ECS cluster, task definition, service, ALB, target group,
# CloudWatch log group, and IAM roles for the Percy Main API.

# ------------------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------------------

variable "environment" {
  type = string
}

variable "task_count" {
  type    = number
  default = 2
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "ecr_repository_url" {
  type = string
}

variable "acm_certificate_arn" {
  type = string
}

variable "secrets" {
  description = "Map of secret name to Secrets Manager or SSM Parameter ARN (resolved via valueFrom) for the API runtime task"
  type        = map(string)
  default     = {}
}

variable "migration_secrets" {
  description = "Map of secret name to Secrets Manager or SSM Parameter ARN for the migration runner task. Typically just DATABASE_URL → app_ddl. Defaults to {} which makes the migration task identical to the API task (legacy behaviour before #130)."
  type        = map(string)
  default     = {}
}

variable "migration_environment_variables" {
  description = "Plain-text env vars for the migration runner task. Should be the minimal set migrate.ts needs (LOG_LEVEL, NODE_ENV)."
  type        = map(string)
  default     = {}
}

variable "health_check_path" {
  type        = string
  default     = "/health/ready"
  description = "ALB target group health check path. Defaults to /health/ready (returns 503 on DB outage so the instance drains). Set to /health/live for pure liveness; legacy /health is also still served."
}

variable "log_retention_days" {
  type    = number
  default = 180
}

variable "assign_public_ip" {
  type    = bool
  default = false
}

variable "max_task_count" {
  type        = number
  default     = 4
  description = "Maximum number of ECS tasks for auto-scaling"
}

variable "ses_identity_arn" {
  type        = string
  default     = ""
  description = "ARN of the SES identity to restrict sending to (if empty, allows all)"
}

variable "newrelic_license_key_arn" {
  type        = string
  default     = ""
  description = "ARN of the Secrets Manager value for the New Relic license key. When set, enables the New Relic Infrastructure sidecar and OTel export."
}

variable "documents_bucket_arn" {
  type        = string
  description = "ARN of the S3 bucket for permanent policy documents."
}

variable "document_uploads_bucket_arn" {
  type        = string
  description = "ARN of the temporary document uploads bucket (browser-direct uploads)."
}

variable "scout_reports_bucket_arn" {
  type        = string
  description = "ARN of the S3 bucket for AI-generated Scout report PDFs."
}

variable "scout_attachment_uploads_bucket_arn" {
  type        = string
  description = "ARN of the temporary scout attachment uploads bucket (browser-direct uploads)."
}

variable "scout_attachments_bucket_arn" {
  type        = string
  description = "ARN of the permanent scout attachments bucket (committed image / PDF originals)."
}

variable "scout_kb_uploads_bucket_arn" {
  type        = string
  description = "ARN of the temporary scout knowledge-base uploads bucket (browser-direct uploads of admin-supplied reference docs)."
}

variable "scout_kb_bucket_arn" {
  type        = string
  description = "ARN of the permanent scout knowledge-base bucket (committed reference docs)."
}

variable "enable_nri_ecs_alarm" {
  type        = bool
  default     = false
  description = "Create a dedicated SNS topic + alarm that fires when the newrelic-infra sidecar logs failure messages. Operators subscribe out of band. Disabled by default to avoid a module cycle when monitoring's SNS topic is passed in."
}

variable "otel_endpoint" {
  type        = string
  default     = "https://otlp.eu01.nr-data.net"
  description = "OTLP HTTP endpoint for OTel exporter. Override if NR account region changes (e.g. https://otlp.nr-data.net for US)."
}

variable "otel_traces_sampler_arg" {
  type        = string
  default     = "1.0"
  description = "Trace sampler ratio (0.0-1.0) for OTEL_TRACES_SAMPLER=parentbased_traceidratio. 1.0 = sample everything (current low traffic); reduce when volume / cost demands."
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
    Module      = "ecs-service"
  }
}

# ------------------------------------------------------------------------------
# Data Sources
# ------------------------------------------------------------------------------

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ------------------------------------------------------------------------------
# CloudWatch Log Group
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-api"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

# ------------------------------------------------------------------------------
# ECS Cluster
# ------------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  # Enabled so the monitoring module's task-count-drop alarm (#205) has
  # ECS/ContainerInsights DesiredTaskCount + RunningTaskCount metrics
  # to alarm against. Without this, those metrics are not published
  # and the alarm sits in INSUFFICIENT_DATA forever. The cost is the
  # extra CW Logs ingest for ContainerInsights — small at our scale.
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# IAM — Task Execution Role
# (Used by ECS agent to pull images, read secrets, push logs)
# ------------------------------------------------------------------------------

resource "aws_iam_role" "task_execution" {
  name = "${local.name_prefix}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "${local.name_prefix}-execution-secrets-and-params"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = ["arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:*percy-main*"]
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.environment}/percy-main/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# IAM — Task Role
# (Used by the running application container for AWS SDK calls)
# ------------------------------------------------------------------------------

resource "aws_iam_role" "task" {
  name = "${local.name_prefix}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "task_ses" {
  name = "${local.name_prefix}-task-ses"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3" {
  name = "${local.name_prefix}-task-s3"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${local.name_prefix}-uploads",
          "arn:aws:s3:::${local.name_prefix}-uploads/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_documents" {
  name = "${local.name_prefix}-task-s3-documents"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          var.documents_bucket_arn,
          "${var.documents_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_run_sync" {
  name = "${local.name_prefix}-task-run-sync"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.api.family}:*"
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.task_execution.arn,
          aws_iam_role.task.arn,
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_document_uploads" {
  name = "${local.name_prefix}-task-s3-document-uploads"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = [
          var.document_uploads_bucket_arn,
          "${var.document_uploads_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_scout_reports" {
  name = "${local.name_prefix}-task-s3-scout-reports"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          var.scout_reports_bucket_arn,
          "${var.scout_reports_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_scout_attachment_uploads" {
  name = "${local.name_prefix}-task-s3-scout-attachment-uploads"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = [
          var.scout_attachment_uploads_bucket_arn,
          "${var.scout_attachment_uploads_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_scout_attachments" {
  name = "${local.name_prefix}-task-s3-scout-attachments"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          var.scout_attachments_bucket_arn,
          "${var.scout_attachments_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_rekognition_detect_faces" {
  name = "${local.name_prefix}-task-rekognition-detect-faces"
  role = aws_iam_role.task.id

  # Scout's recognition-source pipeline runs face DETECTION (bounding boxes
  # only) on candidate images so the captain sees pre-cropped thumbnails of
  # every face in a team / match photo. This is not face recognition —
  # DetectFaces is stateless and returns geometry only. See ADR 042.
  # Rekognition doesn't support resource-level scoping for stateless ops,
  # hence Resource = "*".
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["rekognition:DetectFaces"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_scout_kb_uploads" {
  name = "${local.name_prefix}-task-s3-scout-kb-uploads"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = [
          var.scout_kb_uploads_bucket_arn,
          "${var.scout_kb_uploads_bucket_arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_s3_scout_kb" {
  name = "${local.name_prefix}-task-s3-scout-kb"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          var.scout_kb_bucket_arn,
          "${var.scout_kb_bucket_arn}/*"
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# ECS Task Definition
# ------------------------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode(concat(
    [
      {
        name      = "api"
        image     = "${var.ecr_repository_url}:${var.image_tag}"
        essential = true

        portMappings = [
          {
            containerPort = 3000
            protocol      = "tcp"
          }
        ]

        environment = concat(
          [
            for name, value in var.environment_variables : {
              name  = name
              value = value
            }
          ],
          var.newrelic_license_key_arn != "" ? [
            { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = var.otel_endpoint },
            { name = "OTEL_SERVICE_NAME", value = "${local.name_prefix}-api" },
            # OTEL_RESOURCE_ATTRIBUTES — propagated to every span /
            # metric / log record so NR can filter by environment,
            # release SHA (set in ECS task env by deploy.yml from
            # #224), and service name. release.id falls back to
            # "unknown" when RELEASE_SHA isn't set (local / staging
            # without the deploy workflow patching the task def).
            { name = "OTEL_RESOURCE_ATTRIBUTES", value = "service.name=${local.name_prefix}-api,deployment.environment=${var.environment},service.namespace=percy-main" },
            # Sample everything for now — low traffic. Switch to ratio
            # < 1.0 if/when volume warrants it.
            { name = "OTEL_TRACES_SAMPLER", value = "parentbased_traceidratio" },
            { name = "OTEL_TRACES_SAMPLER_ARG", value = var.otel_traces_sampler_arg },
          ] : []
        )

        secrets = concat(
          [
            for name, arn in var.secrets : {
              name      = name
              valueFrom = arn
            }
          ],
          var.newrelic_license_key_arn != "" ? [
            { name = "NEW_RELIC_LICENSE_KEY", valueFrom = var.newrelic_license_key_arn },
          ] : []
        )

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.api.name
            "awslogs-region"        = data.aws_region.current.region
            "awslogs-stream-prefix" = "api"
          }
        }
      }
    ],
    var.newrelic_license_key_arn != "" ? [
      {
        name      = "newrelic-infra"
        image     = "newrelic/nri-ecs:1.11.15"
        essential = false
        cpu       = 64
        memory    = 128

        environment = [
          { name = "NRIA_OVERRIDE_HOST_ROOT", value = "" },
          { name = "NRIA_IS_FORWARD_ONLY", value = "true" },
          { name = "NRIA_PASSTHROUGH_ENVIRONMENT", value = "ECS_CONTAINER_METADATA_URI,ECS_CONTAINER_METADATA_URI_V4,FARGATE" },
          { name = "FARGATE", value = "true" },
        ]

        secrets = [
          { name = "NRIA_LICENSE_KEY", valueFrom = var.newrelic_license_key_arn },
        ]

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.api.name
            "awslogs-region"        = data.aws_region.current.region
            "awslogs-stream-prefix" = "newrelic-infra"
          }
        }
      }
    ] : []
  ))

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Migration Task Definition (#130 — principle of least privilege)
#
# Same image, same task role, same execution role as the API task. The
# split is in the *secrets* map: the API task gets DATABASE_URL pointing
# at app_rw, this task gets DATABASE_URL pointing at app_ddl. Because
# ECS injects secrets into the container's env at startup (via the
# execution role, not the task role) only what each task definition
# *declares* lands in env — a runtime compromise of the API container
# cannot see the app_ddl URL even though both secrets live under the
# same `*percy-main*` IAM allow.
#
# Falls back to the API task's secrets/env if migration_* vars are empty
# (legacy behaviour before app_rw/app_ddl are wired) so this task def
# stays useful end-to-end even pre-cutover.
# ------------------------------------------------------------------------------

locals {
  migration_secrets               = length(var.migration_secrets) > 0 ? var.migration_secrets : var.secrets
  migration_environment_variables = length(var.migration_environment_variables) > 0 ? var.migration_environment_variables : var.environment_variables
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${var.environment}-api-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      # Same name as the API container so deploy.yml's existing
      # `containerOverrides[0].name = "api"` keeps working.
      name      = "api"
      image     = "${var.ecr_repository_url}:${var.image_tag}"
      essential = true
      command   = ["node", "apps/api/dist/migrate.js"]

      environment = [
        for name, value in local.migration_environment_variables : {
          name  = name
          value = value
        }
      ]

      secrets = [
        for name, arn in local.migration_secrets : {
          name      = name
          valueFrom = arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = data.aws_region.current.region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])

  tags = local.tags
}

# ------------------------------------------------------------------------------
# ALB Access Logs Bucket
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "alb_logs" {
  bucket = "${local.name_prefix}-alb-logs"
  tags   = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter {}

    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_elb_service_account" "main" {}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = data.aws_elb_service_account.main.arn
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.alb_logs.arn}/alb/*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# ALB
# ------------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb"
    enabled = true
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Target Group
# ------------------------------------------------------------------------------

resource "aws_lb_target_group" "api" {
  name                 = "${local.name_prefix}-api-tg"
  port                 = 3000
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# ALB Listeners
# ------------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = local.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# ECS Service
# ------------------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name            = "${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.task_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# ECS Auto Scaling
# ------------------------------------------------------------------------------

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.max_task_count
  min_capacity       = var.task_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "${local.name_prefix}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "service_name" {
  description = "Name of the ECS service"
  value       = aws_ecs_service.api.name
}

output "cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}

output "service_arn" {
  description = "ARN of the ECS service"
  value       = aws_ecs_service.api.id
}

output "task_execution_role_arn" {
  description = "ARN of the ECS task execution IAM role"
  value       = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  description = "ARN of the ECS task IAM role"
  value       = aws_iam_role.task.arn
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_arn_suffix" {
  description = "ARN suffix of the ALB (for CloudWatch metrics)"
  value       = aws_lb.main.arn_suffix
}

output "target_group_arn_suffix" {
  description = "ARN suffix of the target group (for CloudWatch metrics)"
  value       = aws_lb_target_group.api.arn_suffix
}

output "alb_zone_id" {
  description = "Route 53 zone ID of the ALB (for alias records)"
  value       = aws_lb.main.zone_id
}

output "task_definition_arn" {
  description = "ARN of the ECS task definition family (without revision)"
  value       = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.api.family}"
}

output "migration_task_definition_arn" {
  description = "ARN of the migration ECS task definition family (without revision). Workflow registers a new revision per deploy with the freshly built image."
  value       = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.migration.family}"
}

output "migration_task_definition_family" {
  description = "Family name of the migration ECS task definition (without revision)"
  value       = aws_ecs_task_definition.migration.family
}

output "task_definition_family" {
  description = "Family name of the ECS task definition (without revision)"
  value       = aws_ecs_task_definition.api.family
}

output "log_group_name" {
  description = "CloudWatch log group name for the API task"
  value       = aws_cloudwatch_log_group.api.name
}

# ------------------------------------------------------------------------------
# nri-ecs sidecar failure detection
# ------------------------------------------------------------------------------
# The newrelic-infra sidecar runs with essential = false: if NR ingest
# dies (license key invalid, NR endpoint unreachable, sidecar crash-
# looping) the task continues serving traffic and the failure is
# invisible. A log metric filter against the sidecar's stream catches
# the common failure signatures and surfaces them via SNS.
#
# Dedicated SNS topic (rather than monitoring's alarms topic) avoids a
# module dependency cycle: monitoring already takes ecs.cluster_name
# and ecs.service_name, so ecs cannot also depend on
# monitoring.sns_topic_arn. Operators subscribe to this topic out of
# band.

resource "aws_sns_topic" "nri_ecs_alarms" {
  count = var.enable_nri_ecs_alarm ? 1 : 0
  name  = "${local.name_prefix}-nri-ecs-alarms"
  tags  = local.tags
}

resource "aws_cloudwatch_log_metric_filter" "nri_ecs_errors" {
  count = var.enable_nri_ecs_alarm ? 1 : 0

  name           = "${local.name_prefix}-nri-ecs-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  # Match nri-ecs failure phrases only. CloudWatch metric filters can't
  # restrict by log stream, so the patterns are deliberately NR-specific
  # to avoid matching app logs that happen to contain the word "ERROR".
  # If the sidecar's failure vocabulary changes in a future NR Infra
  # release this filter needs updating — track via a periodic alarm
  # smoke test rather than relying on the alarm itself to never trip.
  pattern = "?\"failed to send metrics\" ?\"License key not valid\" ?\"unauthorized\" ?\"InvalidLicenseKey\""

  metric_transformation {
    name          = "NriEcsErrors"
    namespace     = "PercyMain/Observability"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "nri_ecs_failure" {
  count = var.enable_nri_ecs_alarm ? 1 : 0

  alarm_name          = "${local.name_prefix}-nri-ecs-failure"
  alarm_description   = "newrelic-infra sidecar is logging errors — NR ingest from this task may be dropping silently. Check the newrelic-infra log stream."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.nri_ecs_errors[0].metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.nri_ecs_errors[0].metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.nri_ecs_alarms[0].arn]
  ok_actions    = [aws_sns_topic.nri_ecs_alarms[0].arn]

  tags = local.tags
}
