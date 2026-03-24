# New Relic CloudWatch Metric Streams
# Streams CloudWatch metrics from AWS to New Relic via Kinesis Firehose.
# This provides RDS, ECS, ALB, and other AWS service metrics in New Relic.

# ------------------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------------------

variable "environment" {
  type = string
}

variable "newrelic_license_key_arn" {
  type        = string
  description = "ARN of the Secrets Manager value for the New Relic license key"
}

variable "newrelic_account_id" {
  type        = string
  description = "New Relic account ID"
}

variable "include_namespaces" {
  type        = list(string)
  default     = ["AWS/RDS", "AWS/ECS", "AWS/ApplicationELB", "AWS/S3"]
  description = "CloudWatch metric namespaces to stream to New Relic"
}

# ------------------------------------------------------------------------------
# Locals
# ------------------------------------------------------------------------------

locals {
  name_prefix = "percy-main-${var.environment}"

  # New Relic EU Metric API endpoint for Firehose
  newrelic_endpoint = "https://aws-api.eu01.nr-data.net/cloudwatch-metrics/v1"

  tags = {
    Environment = var.environment
    Project     = "percy-main"
    ManagedBy   = "terraform"
    Module      = "newrelic-metrics"
  }
}

# ------------------------------------------------------------------------------
# Data Sources
# ------------------------------------------------------------------------------

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Read the license key from Secrets Manager for Firehose HTTP endpoint auth
data "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = regex("^(arn:aws:secretsmanager:[^:]+:[^:]+:secret:[^:]+)", var.newrelic_license_key_arn)[0]
}

locals {
  license_key = jsondecode(data.aws_secretsmanager_secret_version.app_secrets.secret_string)["NEW_RELIC_LICENSE_KEY"]
}

# ------------------------------------------------------------------------------
# S3 Bucket — Firehose error delivery
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "firehose_errors" {
  bucket = "${local.name_prefix}-nr-firehose-errors"
  tags   = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "firehose_errors" {
  bucket = aws_s3_bucket.firehose_errors.id

  rule {
    id     = "expire-errors"
    status = "Enabled"
    filter {}

    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_public_access_block" "firehose_errors" {
  bucket = aws_s3_bucket.firehose_errors.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ------------------------------------------------------------------------------
# IAM — Firehose delivery role
# ------------------------------------------------------------------------------

resource "aws_iam_role" "firehose" {
  name = "${local.name_prefix}-nr-firehose"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "firehose.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "firehose" {
  name = "${local.name_prefix}-nr-firehose"
  role = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.firehose_errors.arn,
          "${aws_s3_bucket.firehose_errors.arn}/*"
        ]
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# IAM — CloudWatch Metric Stream role
# ------------------------------------------------------------------------------

resource "aws_iam_role" "metric_stream" {
  name = "${local.name_prefix}-nr-metric-stream"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "streams.metrics.cloudwatch.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "metric_stream" {
  name = "${local.name_prefix}-nr-metric-stream"
  role = aws_iam_role.metric_stream.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "firehose:PutRecord",
          "firehose:PutRecordBatch"
        ]
        Resource = aws_kinesis_firehose_delivery_stream.newrelic.arn
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Kinesis Firehose — delivers metrics to New Relic
# ------------------------------------------------------------------------------

resource "aws_kinesis_firehose_delivery_stream" "newrelic" {
  name        = "${local.name_prefix}-nr-metrics"
  destination = "http_endpoint"

  http_endpoint_configuration {
    url                    = local.newrelic_endpoint
    name                   = "New Relic"
    access_key             = local.license_key
    buffering_size         = 1
    buffering_interval     = 60
    role_arn = aws_iam_role.firehose.arn

    s3_configuration {
      role_arn            = aws_iam_role.firehose.arn
      bucket_arn          = aws_s3_bucket.firehose_errors.arn
      buffering_size      = 5
      buffering_interval  = 300
      compression_format  = "GZIP"
      error_output_prefix = "errors/"
    }

    request_configuration {
      content_encoding = "GZIP"
    }
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# CloudWatch Metric Stream
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_stream" "newrelic" {
  name          = "${local.name_prefix}-nr-metrics"
  role_arn      = aws_iam_role.metric_stream.arn
  firehose_arn  = aws_kinesis_firehose_delivery_stream.newrelic.arn
  output_format = "opentelemetry1.0"

  dynamic "include_filter" {
    for_each = var.include_namespaces
    content {
      namespace = include_filter.value
    }
  }

  tags = local.tags
}
