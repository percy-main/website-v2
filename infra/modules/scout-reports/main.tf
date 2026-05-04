# Scout Reports Bucket Module
# Provisions an S3 bucket for AI-generated scouting report PDFs.
# Access is via pre-signed URLs only — no CloudFront origin.
# No Object Lock: reports are user-private artefacts, not auditable records.

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  type = string
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  bucket_name = "percy-main-${var.environment}-scout-reports"
  common_tags = {
    Environment = var.environment
    Module      = "scout-reports"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Scout Reports
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "scout_reports" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout_reports" {
  bucket = aws_s3_bucket.scout_reports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "scout_reports" {
  bucket = aws_s3_bucket.scout_reports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Reports are throwaway artefacts. Keep cleanup automatic so the bucket
# doesn't accumulate forever — deleted DB rows leave orphaned S3 objects
# that nothing else cleans up.
resource "aws_s3_bucket_lifecycle_configuration" "scout_reports" {
  bucket = aws_s3_bucket.scout_reports.id

  rule {
    id     = "expire-old-reports"
    status = "Enabled"

    filter {}

    expiration {
      days = 365
    }
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  value       = aws_s3_bucket.scout_reports.id
  description = "S3 bucket name for scout reports"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout_reports.arn
  description = "S3 bucket ARN for scout reports"
}
