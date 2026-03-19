terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "percy-main-terraform-state-bucket"
    key            = "shared/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "percy-main-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "eu-west-2"
}

# us-east-1 provider for CloudFront ACM certificate
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# -----------------------------------------------------------------------------
# Route 53
# -----------------------------------------------------------------------------

resource "aws_route53_zone" "main" {
  name = var.domain_name
}

# -----------------------------------------------------------------------------
# ECR Repository
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name                 = "percy-main-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 25 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 25
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# SES Domain Identity + DKIM
# -----------------------------------------------------------------------------

resource "aws_ses_domain_identity" "notifications" {
  domain = var.ses_subdomain
}

resource "aws_ses_domain_dkim" "notifications" {
  domain = aws_ses_domain_identity.notifications.domain
}

resource "aws_route53_record" "ses_dkim" {
  for_each = toset(aws_ses_domain_dkim.notifications.dkim_tokens)

  zone_id = aws_route53_zone.main.zone_id
  name    = "${each.value}._domainkey.${var.ses_subdomain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${each.value}.dkim.amazonses.com"]
}

resource "aws_route53_record" "ses_verification" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_amazonses.${var.ses_subdomain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.notifications.verification_token]
}

# -----------------------------------------------------------------------------
# GitHub Actions OIDC Provider
# -----------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# -----------------------------------------------------------------------------
# IAM Role: Terraform Apply (GitHub Actions — main branch only)
# Has full permissions needed to manage infrastructure.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "terraform_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "terraform" {
  name               = "percy-main-terraform"
  assume_role_policy = data.aws_iam_policy_document.terraform_assume.json
}

resource "aws_iam_role_policy_attachment" "terraform_admin" {
  role       = aws_iam_role.terraform.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# -----------------------------------------------------------------------------
# IAM Role: Terraform Plan (GitHub Actions — PRs, read-only)
# Used during pull requests for plan-only operations.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "terraform_plan_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "terraform_plan" {
  name               = "percy-main-terraform-plan"
  assume_role_policy = data.aws_iam_policy_document.terraform_plan_assume.json
}

resource "aws_iam_role_policy_attachment" "terraform_plan_readonly" {
  role       = aws_iam_role.terraform_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# -----------------------------------------------------------------------------
# IAM Role: Deploy (GitHub Actions — main branch only)
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "percy-main-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "deploy_ecr" {
  statement {
    sid    = "ECRAuth"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ECRPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [aws_ecr_repository.api.arn]
  }
}

resource "aws_iam_role_policy" "deploy_ecr" {
  name   = "ecr-push"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_ecr.json
}

data "aws_iam_policy_document" "deploy_ecs" {
  statement {
    sid    = "ECSDeployService"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
    ]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/percy-main-*",
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/percy-main-*/*",
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/percy-main-*/*",
    ]
  }

  statement {
    sid    = "ECSTaskDefinitions"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ECSRunTask"
    effect = "Allow"
    actions = [
      "ecs:RunTask",
    ]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/*-api:*",
    ]
  }
}

resource "aws_iam_role_policy" "deploy_ecs" {
  name   = "ecs-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_ecs.json
}

data "aws_iam_policy_document" "deploy_s3_cloudfront" {
  statement {
    sid    = "S3Sync"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      "arn:aws:s3:::percy-main-*",
      "arn:aws:s3:::percy-main-*/*",
    ]
  }

  statement {
    sid    = "CloudFrontInvalidation"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
      "cloudfront:ListInvalidations",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy_s3_cloudfront" {
  name   = "s3-cloudfront"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_s3_cloudfront.json
}

data "aws_iam_policy_document" "deploy_iam_passrole" {
  statement {
    sid    = "IAMPassRole"
    effect = "Allow"
    actions = [
      "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/percy-main-*",
    ]
  }
}

resource "aws_iam_role_policy" "deploy_iam_passrole" {
  name   = "iam-passrole"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_iam_passrole.json
}

data "aws_iam_policy_document" "deploy_secrets" {
  statement {
    sid    = "SecretsManagerRead"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:percy-main-*",
    ]
  }
}

resource "aws_iam_role_policy" "deploy_secrets" {
  name   = "secrets-manager-read"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_secrets.json
}

# -----------------------------------------------------------------------------
# ACM Certificate — ALB (eu-west-2)
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "alb" {
  domain_name               = "api.v2.${var.domain_name}"
  subject_alternative_names = []
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "alb_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.alb.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for record in aws_route53_record.alb_cert_validation : record.fqdn]
}

# -----------------------------------------------------------------------------
# ACM Certificate — CloudFront (us-east-1)
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "cloudfront" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cloudfront_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cloudfront.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for record in aws_route53_record.cloudfront_cert_validation : record.fqdn]
}
