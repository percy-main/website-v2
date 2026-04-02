# Document Uploads Bucket Module
# Temporary landing zone for browser-direct PDF uploads via pre-signed URLs.
# Files are copied to the permanent documents bucket by the API, then cleaned
# up by the 24-hour lifecycle rule.

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
  bucket_name = "percy-main-${var.environment}-document-uploads"
  common_tags = {
    Environment = var.environment
    Module      = "document-uploads"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Document Uploads (temporary)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "document_uploads" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  rule {
    id     = "expire-pending-uploads"
    status = "Enabled"
    filter {}

    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = var.domain_name != "" ? ["https://${var.domain_name}"] : ["*"]
    max_age_seconds = 3600
  }
}

# No versioning — temporary files, no audit requirement
# No Object Lock — files are ephemeral
# No CloudFront — access via pre-signed URLs only

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  value       = aws_s3_bucket.document_uploads.id
  description = "S3 bucket name for temporary document uploads"
}

output "bucket_arn" {
  value       = aws_s3_bucket.document_uploads.arn
  description = "S3 bucket ARN for temporary document uploads"
}
