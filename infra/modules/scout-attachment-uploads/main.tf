# Scout Attachment Uploads Bucket Module
# Temporary landing zone for browser-direct image / PDF uploads via
# pre-signed URLs. Files are downloaded by the API for derive (caption /
# transcribe) then copied to the permanent attachments bucket. The 24h
# lifecycle rule is the safety net for orphaned uploads (mint succeeded,
# commit never came).

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  type = string
}

variable "domain_name" {
  type    = string
  default = ""
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  bucket_name = "percy-main-${var.environment}-scout-attachment-uploads"
  common_tags = {
    Environment = var.environment
    Module      = "scout-attachment-uploads"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Scout Attachment Uploads (temporary)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "scout_attachment_uploads" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout_attachment_uploads" {
  bucket = aws_s3_bucket.scout_attachment_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "scout_attachment_uploads" {
  bucket = aws_s3_bucket.scout_attachment_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "scout_attachment_uploads" {
  bucket = aws_s3_bucket.scout_attachment_uploads.id

  rule {
    id     = "expire-pending-uploads"
    status = "Enabled"
    filter {}

    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "scout_attachment_uploads" {
  bucket = aws_s3_bucket.scout_attachment_uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = var.domain_name != "" ? ["https://${var.domain_name}", "https://www.${var.domain_name}"] : ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  value       = aws_s3_bucket.scout_attachment_uploads.id
  description = "S3 bucket name for temporary scout attachment uploads"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout_attachment_uploads.arn
  description = "S3 bucket ARN for temporary scout attachment uploads"
}
