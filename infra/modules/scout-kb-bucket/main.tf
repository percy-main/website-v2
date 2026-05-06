# Scout KB Bucket Module
# Permanent store for committed knowledge base documents (PDFs / images /
# text) that admins have uploaded for the Scout agent to retrieve from.
# Lifecycle is bound to the scout_kb_document row via worker-managed
# delete; there is no S3 lifecycle expiry. Access is via pre-signed
# GETs from the admin UI only.

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
  bucket_name = "percy-main-${var.environment}-scout-kb"
  common_tags = {
    Environment = var.environment
    Module      = "scout-kb-bucket"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Scout KB (permanent)
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "scout_kb" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout_kb" {
  bucket = aws_s3_bucket.scout_kb.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "scout_kb" {
  bucket = aws_s3_bucket.scout_kb.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# No lifecycle rule, no Object Lock, no CloudFront — see module header.

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bucket_name" {
  value       = aws_s3_bucket.scout_kb.id
  description = "S3 bucket name for the permanent scout KB"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout_kb.arn
  description = "S3 bucket ARN for the permanent scout KB"
}
