# Documents Bucket Module
# Provisions an S3 bucket for auditable policy documents.
# Access is via pre-signed URLs only — no CloudFront origin.
# Object Lock (compliance mode) prevents deletion/overwriting.

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
  bucket_name = "percy-main-${var.environment}-documents"
  common_tags = {
    Environment = var.environment
    Module      = "documents-bucket"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Documents
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "documents" {
  bucket              = local.bucket_name
  object_lock_enabled = true

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      years = 7
    }
  }
}

# No lifecycle rules — documents remain in standard storage indefinitely
# No CORS — access is via pre-signed URLs from the API, not browser uploads
# No CloudFront — access is via pre-signed GET URLs only

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  value       = aws_s3_bucket.documents.id
  description = "S3 bucket name for policy documents"
}

output "bucket_arn" {
  value       = aws_s3_bucket.documents.arn
  description = "S3 bucket ARN for policy documents"
}
