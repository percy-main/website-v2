output "zone_id" { value = aws_route53_zone.main.zone_id }
output "zone_name_servers" { value = aws_route53_zone.main.name_servers }
output "ecr_repository_url" { value = aws_ecr_repository.api.repository_url }
output "acm_alb_certificate_arn" { value = aws_acm_certificate.alb.arn }
output "acm_cloudfront_certificate_arn" { value = aws_acm_certificate.cloudfront.arn }
output "terraform_role_arn" { value = aws_iam_role.terraform.arn }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
