output "api_url" {
  value = "https://api.${var.domain_name}"
}

output "web_url" {
  value = "https://${var.domain_name}"
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "api_gateway_test_url" {
  value       = module.api_gateway.test_url
  description = "Pre-cutover API Gateway verification hostname (#722)"
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "frontend_bucket_name" {
  value = module.cdn.frontend_bucket_name
}

# ── matchday PWA — set the deploy job's GH Actions variables to these
# after the first apply:
#   MATCHDAY_FRONTEND_BUCKET             = matchday_frontend_bucket_name
#   MATCHDAY_CLOUDFRONT_DISTRIBUTION_ID  = matchday_cloudfront_distribution_id
# Also add a Netlify CNAME `matchday → <matchday_cloudfront_domain>`.

output "matchday_url" {
  value = "https://matchday.${var.domain_name}"
}

output "matchday_cloudfront_distribution_id" {
  value = module.cdn_matchday.distribution_id
}

output "matchday_cloudfront_domain" {
  value       = module.cdn_matchday.distribution_domain_name
  description = "Point a CNAME at this from Netlify (matchday → <value>)"
}

output "matchday_frontend_bucket_name" {
  value = module.cdn_matchday.frontend_bucket_name
}
