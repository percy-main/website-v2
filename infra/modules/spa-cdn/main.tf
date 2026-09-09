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
      version = "~> 6.45"
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

# index.html must be re-fetched every deploy — Vite ships hashed asset
# filenames but the index references the new hashes, so a long-TTL on
# index would pin clients to the old bundle until the next CF
# invalidation. The deploy step also stamps `Cache-Control: max-age=0,
# must-revalidate` on the index.html object as belt-and-braces; this
# cache policy is the load-bearing one.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
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

# Vite ships hashed asset filenames so rollback is technically survivable
# via redeploy, but versioning is cheap and means a botched `aws s3 sync
# --delete` doesn't lose the previous build's index.html.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
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

resource "aws_s3_bucket_server_side_encryption_configuration" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront standard log delivery writes objects with the uploader's
# canonical ID and grants WRITE+READ_ACP via the log-delivery-write
# ACL. New AWS accounts default Object Ownership to BucketOwnerEnforced
# which disables ACLs entirely; ObjectWriter is required for CloudFront
# logs to land here.
resource "aws_s3_bucket_ownership_controls" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  rule {
    object_ownership = "ObjectWriter"
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
# CloudFront Response Headers Policy - Security Headers
#
# Attached to every cache behavior. Sets X-Content-Type-Options: nosniff,
# clickjacking protection (CSP frame-ancestors 'self' + the legacy
# X-Frame-Options: SAMEORIGIN fallback, which matches 'self'), and HSTS.
#
# HSTS is intentionally conservative: a 1-year max-age WITHOUT
# include_subdomains and WITHOUT preload. Those two flags are the
# effectively-irreversible part of HSTS (preload removal takes months,
# and include_subdomains would break any subdomain that is ever served
# over plain HTTP). Without them this is reversible: setting max-age to 0
# clears it on a client's next visit. Ramp to include_subdomains/preload
# only after confirming every subdomain is HTTPS-only.
# -----------------------------------------------------------------------------

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.environment}-${var.name}-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    content_security_policy {
      content_security_policy = "frame-ancestors 'self'"
      override                = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }
  }
}

# -----------------------------------------------------------------------------
# CloudFront Distribution
# -----------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "main" {
  # CloudFront's CreateDistribution call validates at request time that
  # the logging bucket has ACLs enabled (ownership = ObjectWriter or
  # BucketOwnerPreferred). The distribution's only implicit dependency
  # on the logs bucket is via `bucket_domain_name`, so without this
  # explicit chain TF runs the ACL/ownership setup in parallel with
  # CreateDistribution and the create races to a 400:
  #   "The S3 bucket ... does not enable ACL access".
  depends_on = [
    aws_s3_bucket_ownership_controls.cdn_logs,
    aws_s3_bucket_acl.cdn_logs,
  ]

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

  # /index.html — must never cache long. Separate behaviour so a deploy
  # is immediately visible without an explicit invalidation of the root
  # object (the path-pattern catches direct hits; the CF Function also
  # rewrites bare-path navigations to /index.html, which then matches
  # this behaviour at the cache lookup).
  ordered_cache_behavior {
    path_pattern               = "/index.html"
    target_origin_id           = local.frontend_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]
    compress        = true
  }

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

  # No `custom_error_response` 403/404 → index.html: that combo with the
  # CF Function's path rewrite would mask a missing JS chunk by serving
  # the SPA shell with content-type text/html, which the browser tries
  # to execute as JS and explodes. The CF Function already turns every
  # extensionless path into /index.html before origin lookup, so SPA
  # routing is covered; a 403 from S3 on a hashed asset (e.g. an old
  # client requesting a pruned chunk after a deploy) surfaces as a real
  # error and the SW's cleanupOutdatedCaches + skipWaiting picks up the
  # new shell on the next navigation.

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
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
