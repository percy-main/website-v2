# DNS Module
# Provisions Route 53 records for the application.

variable "zone_id" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "alb_dns_name" {
  type    = string
  default = ""
}

variable "cloudfront_domain_name" {
  type    = string
  default = ""
}

# TODO: implement DNS resources
# - aws_route53_record (A/AAAA alias for CloudFront)
# - aws_route53_record (A/AAAA alias for ALB → api.percymain.org)

output "fqdn" {
  value = ""
}
