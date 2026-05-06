# Scout Attachments Bucket Module
# Permanent store for scout chat attachments (images + PDFs) committed
# from the uploads bucket. Lifetime tracks the parent thread via DB
# cascade — there is no S3 lifecycle expiry; orphaned bytes from a
# deleted thread are tolerated for v1 (Scout is admin/official-only,
# low volume). Access is via pre-signed URLs only.

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
  bucket_name = "percy-main-${var.environment}-scout-attachments"
  common_tags = {
    Environment = var.environment
    Module      = "scout-attachments-bucket"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — Scout Attachments
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "scout_attachments" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout_attachments" {
  bucket = aws_s3_bucket.scout_attachments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "scout_attachments" {
  bucket = aws_s3_bucket.scout_attachments.id

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
  value       = aws_s3_bucket.scout_attachments.id
  description = "S3 bucket name for scout attachments"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout_attachments.arn
  description = "S3 bucket ARN for scout attachments"
}
