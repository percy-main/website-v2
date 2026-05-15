output "zone_id" { value = aws_route53_zone.main.zone_id }
output "zone_name_servers" { value = aws_route53_zone.main.name_servers }
output "ecr_repository_url" { value = aws_ecr_repository.api.repository_url }
output "acm_alb_certificate_arn" { value = aws_acm_certificate.alb.arn }
output "acm_cloudfront_certificate_arn" { value = aws_acm_certificate.cloudfront.arn }
output "terraform_role_arn" { value = aws_iam_role.terraform.arn }
output "terraform_plan_role_arn" { value = aws_iam_role.terraform_plan.arn }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "ses_identity_arn" { value = aws_ses_domain_identity.notifications.arn }

# SNS topics for reliability alarms (eu-west-2 + us-east-1).
# Per-region split because CloudFront / Route 53 / ACM (CloudFront) live
# in us-east-1; ALB ACM and SES live in eu-west-2.
output "reliability_alarms_topic_arn" { value = aws_sns_topic.shared_reliability_alarms.arn }
output "reliability_alarms_topic_arn_us_east_1" { value = aws_sns_topic.shared_reliability_alarms_us_east_1.arn }

# Break-glass role for RDS master credentials access (#130 / ADR 043).
# Admins assume this role on demand; the assumption is the audit point.
output "db_break_glass_role_arn" { value = aws_iam_role.db_break_glass.arn }
