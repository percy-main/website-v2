# DNS Module
# Provisions Route 53 records for the application.

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "zone_id" {
  type        = string
  description = "Route 53 hosted zone ID"
}

variable "domain_name" {
  type        = string
  description = "Domain name (e.g. v2.percymain.org)"
}

variable "alb_dns_name" {
  type        = string
  description = "ALB DNS name for the API subdomain"
}

variable "alb_zone_id" {
  type        = string
  description = "ALB hosted zone ID for alias record"
}

variable "cloudfront_domain_name" {
  type        = string
  description = "CloudFront distribution domain name"
}

variable "cloudfront_hosted_zone_id" {
  type        = string
  default     = "Z2FDTNDATAQYW2"
  description = "CloudFront global hosted zone ID (always Z2FDTNDATAQYW2)"
}

# ---------------------------------------------------------------------------
# {domain} -> CloudFront (A + AAAA)
# ---------------------------------------------------------------------------

resource "aws_route53_record" "apex_a" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# ---------------------------------------------------------------------------
# api.{domain} -> ALB (A + AAAA)
# ---------------------------------------------------------------------------

resource "aws_route53_record" "api_a" {
  zone_id = var.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_aaaa" {
  zone_id = var.zone_id
  name    = "api.${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "fqdn" {
  value       = var.domain_name
  description = "The fully qualified domain name"
}
