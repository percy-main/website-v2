# CDN Module (Phase 4)
# Provisions CloudFront distribution, S3 origin bucket, and OAC.

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

# TODO: implement CDN resources (Phase 4)
# - aws_s3_bucket (frontend assets)
# - aws_s3_bucket_policy
# - aws_cloudfront_origin_access_control
# - aws_cloudfront_distribution
#   - Custom error response for SPA routing (403/404 → /index.html)
#   - HTTPS via ACM certificate
# - aws_s3_bucket (user uploads)

output "distribution_id" {
  value = ""
}

output "frontend_bucket_name" {
  value = ""
}

output "uploads_bucket_name" {
  value = ""
}
