# Prerenderer Lambda
#
# Renders published content to static HTML in the frontend bucket and
# keeps the CloudFront KeyValueStore + sitemap.xml in step (see
# apps/web/server/prerender/lambda.ts). Terraform owns the function
# resource, IAM and schedule; deploy-web owns the CODE (update-function-code
# on every web deploy, so the renderer is always built from the exact
# client bundle it must match) - hence ignore_changes on the package.
#
# Invocation paths:
#   - API publish/unpublish/edit -> async invoke {"action":"reconcile"}
#   - deploy-web after S3 sync   -> async invoke {"action":"render-all"}
#   - EventBridge 15-min sweep   -> {"action":"reconcile"} (scheduled
#     publishes crossing go-live, missed triggers, drift)
#
# reserved_concurrent_executions = 1 serialises syncs: concurrent runs
# would race the KVS ETag and the state file; async invokes queue instead.

# ------------------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------------------

variable "environment" {
  type        = string
  description = "Environment name"
}

variable "frontend_bucket_name" {
  type        = string
  description = "Frontend S3 bucket the snapshots are written to"
}

variable "frontend_bucket_arn" {
  type        = string
  description = "Frontend S3 bucket ARN (IAM scoping)"
}

variable "kvs_arn" {
  type        = string
  description = "CloudFront KeyValueStore ARN for prerendered URL keys"
}

variable "distribution_id" {
  type        = string
  description = "CloudFront distribution ID (invalidations)"
}

variable "distribution_arn" {
  type        = string
  description = "CloudFront distribution ARN (invalidation IAM)"
}

variable "site_origin" {
  type        = string
  default     = "https://www.percymain.org"
  description = "Canonical public origin baked into meta tags and the sitemap"
}

variable "alarms_sns_topic_arn" {
  type        = string
  description = "SNS topic for the async-invoke failure destination and the errors alarm"
}

# ------------------------------------------------------------------------------
# Locals
# ------------------------------------------------------------------------------

locals {
  name_prefix   = "percy-main-${var.environment}"
  function_name = "${local.name_prefix}-prerenderer"

  tags = {
    Environment = var.environment
    Project     = "percy-main"
    ManagedBy   = "terraform"
    Module      = "prerender"
  }
}

# ------------------------------------------------------------------------------
# IAM — Lambda execution role
# ------------------------------------------------------------------------------

resource "aws_iam_role" "prerenderer" {
  name = local.function_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "prerenderer_logs" {
  role       = aws_iam_role.prerenderer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "prerenderer" {
  name = "${local.function_name}-sync"
  role = aws_iam_role.prerenderer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SnapshotObjects"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = [
          "${var.frontend_bucket_arn}/_prerender/*",
          "${var.frontend_bucket_arn}/sitemap.xml",
        ]
      },
      {
        # Without ListBucket, a GetObject on a missing key returns
        # AccessDenied instead of NoSuchKey (S3 hides existence), so the
        # Lambda's state-file probe cannot distinguish "first sync" from
        # a real permission failure. Scoped to the snapshot prefix.
        Sid      = "StateProbe"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [var.frontend_bucket_arn]
        Condition = {
          StringLike = { "s3:prefix" = ["_prerender/*"] }
        }
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = [var.distribution_arn]
      },
      {
        Sid    = "KvsSync"
        Effect = "Allow"
        Action = [
          "cloudfront-keyvaluestore:DescribeKeyValueStore",
          "cloudfront-keyvaluestore:GetKey",
          "cloudfront-keyvaluestore:ListKeys",
          "cloudfront-keyvaluestore:PutKey",
          "cloudfront-keyvaluestore:DeleteKey",
          "cloudfront-keyvaluestore:UpdateKeys",
        ]
        Resource = [var.kvs_arn]
      },
      {
        Sid      = "FailureDestination"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [var.alarms_sns_topic_arn]
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda function
# ------------------------------------------------------------------------------

# Placeholder package so Terraform can create the function before the
# first deploy-web run pushes the real bundle.
data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = "export const handler = async () => { throw new Error('prerenderer code not deployed yet - run deploy-web'); };"
    filename = "lambda.mjs"
  }
}

resource "aws_lambda_function" "prerenderer" {
  function_name = local.function_name
  role          = aws_iam_role.prerenderer.arn
  runtime       = "nodejs22.x"
  handler       = "lambda.handler"
  architectures = ["arm64"]
  # 2048 MB buys proportionally faster CPU (renders are renderToString
  # bound); 900s covers a render-all of the full corpus - content plus
  # current-season game pages and calendar months, each game costing a
  # live Play Cricket detail call. The sync also flushes progress in
  # batches, so even a timeout resumes rather than starting over.
  memory_size      = 2048
  timeout          = 900
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  reserved_concurrent_executions = 1

  environment {
    variables = {
      FRONTEND_BUCKET            = var.frontend_bucket_name
      KVS_ARN                    = var.kvs_arn
      CLOUDFRONT_DISTRIBUTION_ID = var.distribution_id
      SITE_ORIGIN                = var.site_origin
      # date-fns "local" formatting in snapshots renders club (UK) time.
      TZ = "Europe/London"
    }
  }

  lifecycle {
    # deploy-web pushes the real bundle with update-function-code.
    ignore_changes = [filename, source_code_hash]
  }

  tags = local.tags
}

# Async-invoke policy: 2 retries, then the failed event lands on the
# alarms topic so a broken renderer is visible (content stays served via
# the CSR fallback / stale snapshot either way).
resource "aws_lambda_function_event_invoke_config" "prerenderer" {
  function_name          = aws_lambda_function.prerenderer.function_name
  maximum_retry_attempts = 2

  destination_config {
    on_failure {
      destination = var.alarms_sns_topic_arn
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "prerenderer_errors" {
  alarm_name          = "${local.function_name}-errors"
  alarm_description   = "Prerenderer Lambda failing - published content is serving stale snapshots or CSR fallback"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.prerenderer.function_name
  }

  alarm_actions = [var.alarms_sns_topic_arn]
  ok_actions    = [var.alarms_sns_topic_arn]
  tags          = local.tags
}

# ------------------------------------------------------------------------------
# EventBridge Scheduler — 15-minute reconcile sweep
#
# The single backstop for scheduled publishes crossing their go-live
# moment (there is no other scheduler in the system), triggers lost while
# the Lambda was down, and any state drift. A no-op sweep is one manifest
# fetch + one state read.
# ------------------------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "${local.function_name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${local.function_name}-scheduler-invoke"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [aws_lambda_function.prerenderer.arn]
    }]
  })
}

resource "aws_scheduler_schedule" "reconcile" {
  name                = "${local.function_name}-reconcile"
  schedule_expression = "rate(15 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.prerenderer.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ action = "reconcile" })
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------

output "function_name" {
  value       = aws_lambda_function.prerenderer.function_name
  description = "Prerenderer Lambda function name (deploy-web update-function-code target)"
}

output "function_arn" {
  value       = aws_lambda_function.prerenderer.arn
  description = "Prerenderer Lambda ARN (API task role invoke permission)"
}
