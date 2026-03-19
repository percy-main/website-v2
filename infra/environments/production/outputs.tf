output "api_url" {
  value = "https://api.${var.domain_name}"
}

output "web_url" {
  value = "https://${var.domain_name}"
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "frontend_bucket_name" {
  value = module.cdn.frontend_bucket_name
}
