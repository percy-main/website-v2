# CDN Module (Phase 4)
# Provisions CloudFront distribution with S3 origins (frontend + uploads),
# ALB origin for API, and Origin Access Control.

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

variable "acm_certificate_arn" {
  type    = string
  default = ""
}

variable "waf_acl_arn" {
  type    = string
  default = ""
}

variable "extra_aliases" {
  type        = list(string)
  default     = []
  description = "Additional domain aliases for the CloudFront distribution"
}

variable "api_base_url" {
  type        = string
  default     = ""
  description = "API base URL for OG image crawler redirects (e.g. https://api.v2.percymain.org)"
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  frontend_bucket_name = "percy-main-${var.environment}-frontend"
  uploads_bucket_name  = "percy-main-${var.environment}-uploads"
  frontend_origin_id   = "s3-frontend"
  uploads_origin_id    = "s3-uploads"
  common_tags = {
    Environment = var.environment
    Module      = "cdn"
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# Data Sources — CloudFront Managed Policies
# -----------------------------------------------------------------------------

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# -----------------------------------------------------------------------------
# S3 Bucket — Frontend Assets
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket = local.frontend_bucket_name

  tags = merge(local.common_tags, {
    Name = local.frontend_bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACRead"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# S3 Bucket — User Uploads
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "uploads" {
  bucket = local.uploads_bucket_name

  tags = merge(local.common_tags, {
    Name = local.uploads_bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACRead"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.uploads.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "transition-to-ia"
    status = "Enabled"
    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = var.domain_name != "" ? ["https://${var.domain_name}"] : ["*"]
    max_age_seconds = 3600
  }
}

# -----------------------------------------------------------------------------
# S3 Bucket — CloudFront Access Logs
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "cdn_logs" {
  bucket = "percy-main-${var.environment}-cdn-logs"

  tags = merge(local.common_tags, {
    Name = "percy-main-${var.environment}-cdn-logs"
  })
}

resource "aws_s3_bucket_public_access_block" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "cdn_logs" {
  depends_on = [aws_s3_bucket_ownership_controls.cdn_logs]
  bucket     = aws_s3_bucket.cdn_logs.id
  acl        = "log-delivery-write"
}

resource "aws_s3_bucket_lifecycle_configuration" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter {}

    expiration {
      days = 90
    }
  }
}

# -----------------------------------------------------------------------------
# CloudFront Origin Access Control
# -----------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.environment}-percy-main-s3-oac"
  description                       = "OAC for Percy Main S3 origins"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# CloudFront Function — SPA Rewrite
# -----------------------------------------------------------------------------

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.environment}-percy-main-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  code = templatefile("${path.module}/spa-rewrite.js", {
    api_base_url = var.api_base_url
  })
}

# -----------------------------------------------------------------------------
# CloudFront Response Headers Policy - Security Headers
#
# Attached to every cache behavior. For now it only sets
# X-Content-Type-Options: nosniff. Later issues will extend this same
# policy with frame-ancestors (CSP) and HSTS.
# -----------------------------------------------------------------------------

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.environment}-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }
  }
}

# -----------------------------------------------------------------------------
# CloudFront Distribution
# -----------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  web_acl_id          = var.waf_acl_arn != "" ? var.waf_acl_arn : null
  aliases             = var.domain_name != "" ? concat([var.domain_name], var.extra_aliases) : var.extra_aliases

  tags = merge(local.common_tags, {
    Name = "${var.environment}-percy-main-cdn"
  })

  # --- Origins ---

  # Frontend S3 bucket
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = local.frontend_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Uploads S3 bucket
  origin {
    domain_name              = aws_s3_bucket.uploads.bucket_regional_domain_name
    origin_id                = local.uploads_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # --- Ordered Cache Behaviors ---

  # /uploads/* -> Uploads S3 bucket (standard caching)
  ordered_cache_behavior {
    path_pattern               = "/uploads/*"
    target_origin_id           = local.uploads_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]
    compress        = true
  }

  # --- Default Cache Behavior (frontend) ---

  default_cache_behavior {
    target_origin_id           = local.frontend_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]
    compress        = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # --- HTTPS Certificate ---

  dynamic "viewer_certificate" {
    for_each = var.acm_certificate_arn != "" ? [1] : []
    content {
      acm_certificate_arn      = var.acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.acm_certificate_arn != "" ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cdn_logs.bucket_domain_name
    prefix          = "cloudfront/"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# -----------------------------------------------------------------------------
# Additional metrics — required for OriginLatency and CacheHitRate alarms
# (see production env). Without this subscription, those metrics are not
# published and the corresponding alarms stay perpetually OK.
# -----------------------------------------------------------------------------

resource "aws_cloudfront_monitoring_subscription" "main" {
  distribution_id = aws_cloudfront_distribution.main.id

  monitoring_subscription {
    realtime_metrics_subscription_config {
      realtime_metrics_subscription_status = "Enabled"
    }
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "distribution_id" {
  value       = aws_cloudfront_distribution.main.id
  description = "CloudFront distribution ID"
}

output "distribution_domain_name" {
  value       = aws_cloudfront_distribution.main.domain_name
  description = "CloudFront distribution domain name"
}

output "distribution_hosted_zone_id" {
  value       = aws_cloudfront_distribution.main.hosted_zone_id
  description = "CloudFront distribution hosted zone ID for Route 53 alias records"
}

output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.id
  description = "S3 bucket name for frontend assets"
}

output "uploads_bucket_name" {
  value       = aws_s3_bucket.uploads.id
  description = "S3 bucket name for user uploads"
}
