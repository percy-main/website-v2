# -----------------------------------------------------------------------------
# SPA CDN module — S3 bucket + CloudFront distribution + OAC.
#
# Slimmer cousin of `modules/cdn`. Used for additional Vite SPAs (e.g.
# matchday.percymain.org) where we just need a static-asset distribution.
# Does not provision an uploads bucket and does not embed the apex/kit
# redirect rules (those live on the main `cdn` distribution).
#
# Outputs the bucket name + distribution ID so CI can sync + invalidate.
# -----------------------------------------------------------------------------

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (e.g. production)"
  type        = string
}

variable "name" {
  description = "Short distinguisher used in resource names (e.g. matchday)"
  type        = string
}

variable "domain_name" {
  description = "Primary alias for this distribution (e.g. matchday.percymain.org)"
  type        = string
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM certificate ARN covering domain_name (SAN or wildcard)"
  type        = string
}

variable "waf_acl_arn" {
  description = "Optional WAFv2 ACL ARN to associate"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  frontend_bucket_name = "percy-main-${var.environment}-${var.name}-frontend"
  cdn_logs_bucket_name = "percy-main-${var.environment}-${var.name}-cdn-logs"
  frontend_origin_id   = "s3-${var.name}-frontend"
  common_tags = {
    Environment = var.environment
    Module      = "spa-cdn"
    App         = var.name
    ManagedBy   = "terraform"
  }
}

# -----------------------------------------------------------------------------
# Data Sources
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
# S3 Bucket — CloudFront Access Logs
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "cdn_logs" {
  bucket = local.cdn_logs_bucket_name

  tags = merge(local.common_tags, {
    Name = local.cdn_logs_bucket_name
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
  name                              = "${var.environment}-${var.name}-s3-oac"
  description                       = "OAC for ${var.name} S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# CloudFront Function — SPA Rewrite
#
# Minimal SPA rewrite — turns deep links into index.html so client-side
# routing works on hard refresh. Static-only; no host-specific redirects.
# -----------------------------------------------------------------------------

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.environment}-${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      // Anything without a file extension is a SPA route — serve index.html.
      // Asset paths (.js, .css, .png, .json, .webmanifest, etc.) pass through.
      if (uri && !uri.includes(".") && uri !== "/") {
        request.uri = "/index.html";
      } else if (uri === "/") {
        request.uri = "/index.html";
      }
      return request;
    }
  EOT
}

# -----------------------------------------------------------------------------
# CloudFront Distribution
# -----------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  web_acl_id          = var.waf_acl_arn != "" ? var.waf_acl_arn : null
  aliases             = var.domain_name != "" ? [var.domain_name] : []

  tags = merge(local.common_tags, {
    Name = "${var.environment}-${var.name}-cdn"
  })

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = local.frontend_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  default_cache_behavior {
    target_origin_id       = local.frontend_origin_id
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]
    compress        = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # Custom error responses — SPAs serve their own 404 page from index.html.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

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
  description = "CloudFront distribution domain name (for the CNAME at DNS)"
}

output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.id
  description = "S3 bucket holding the frontend assets"
}
