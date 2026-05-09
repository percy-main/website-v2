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
  count = 3 # SES DKIM always produces exactly 3 tokens

  zone_id = aws_route53_zone.main.zone_id
  name    = "${aws_ses_domain_dkim.notifications.dkim_tokens[count.index]}._domainkey.${var.ses_subdomain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.notifications.dkim_tokens[count.index]}.dkim.amazonses.com"]
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
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:environment:production",
      ]
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
      # Accept both PR runs (terraform-plan job) and main-branch
      # scheduled / workflow_dispatch runs (terraform-drift workflow).
      # The role grants ReadOnlyAccess + state-lock + secrets-read
      # only — appropriate for both plan and drift.
      values = [
        "repo:${var.github_repo}:pull_request",
        "repo:${var.github_repo}:ref:refs/heads/main",
      ]
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

resource "aws_iam_role_policy" "terraform_plan_extras" {
  name = "terraform-plan-extras"
  role = aws_iam_role.terraform_plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StateLock"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ]
        Resource = "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/percy-main-terraform-locks"
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:*percy-main*"
      }
    ]
  })
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
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:environment:production",
      ]
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

# -----------------------------------------------------------------------------
# Security event notifications
# -----------------------------------------------------------------------------
# EventBridge rules that catch security-sensitive API calls (SG changes,
# IAM policy edits) and route them to per-region SNS topics. Topics
# carry no terraform-managed subscription — operators add an email /
# Slack / Lambda subscription out of band so the audit channel can be
# reconfigured without a TF change. Depends on CloudTrail being on
# (#214).
#
# IMPORTANT: IAM is a global service. CloudTrail/EventBridge IAM API
# events are delivered exclusively to us-east-1, so the IAM rule + its
# SNS target both live there. SG events are regional and stay in the
# default eu-west-2 provider.
#
# SNS topics are intentionally NOT encrypted with `alias/aws/sns` (the
# AWS-managed SNS KMS key cannot have its policy edited, and EventBridge
# needs `kms:GenerateDataKey` against a key that allows
# `events.amazonaws.com` — only a customer-managed CMK can do that).
# Event payloads are CloudTrail event metadata (no secrets), so leaving
# encryption-at-rest off is an acceptable trade. Add a CMK here if the
# threat model later requires it.

# eu-west-2 topic — receives SG-change events.
resource "aws_sns_topic" "security_events" {
  name = "percy-main-shared-security-events"

  tags = {
    Environment = "shared"
    Module      = "shared"
    ManagedBy   = "terraform"
    Purpose     = "security-event-notifications"
  }
}

resource "aws_cloudwatch_event_rule" "sg_changes" {
  name        = "percy-main-shared-sg-changes"
  description = "Security group ingress/egress/lifecycle changes"

  event_pattern = jsonencode({
    source        = ["aws.ec2"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["ec2.amazonaws.com"]
      eventName = [
        "AuthorizeSecurityGroupIngress",
        "AuthorizeSecurityGroupEgress",
        "RevokeSecurityGroupIngress",
        "RevokeSecurityGroupEgress",
        "CreateSecurityGroup",
        "DeleteSecurityGroup",
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "sg_changes_to_sns" {
  rule      = aws_cloudwatch_event_rule.sg_changes.name
  target_id = "sns"
  arn       = aws_sns_topic.security_events.arn
}

# Allow EventBridge to publish to the eu-west-2 topic.
data "aws_iam_policy_document" "security_events_topic" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.security_events.arn]
  }
}

resource "aws_sns_topic_policy" "security_events" {
  arn    = aws_sns_topic.security_events.arn
  policy = data.aws_iam_policy_document.security_events_topic.json
}

# us-east-1 topic + IAM rule — IAM API events surface only in us-east-1.
resource "aws_sns_topic" "security_events_us_east_1" {
  provider = aws.us_east_1
  name     = "percy-main-shared-security-events"

  tags = {
    Environment = "shared"
    Module      = "shared"
    ManagedBy   = "terraform"
    Purpose     = "security-event-notifications-us-east-1"
  }
}

resource "aws_cloudwatch_event_rule" "iam_changes" {
  provider    = aws.us_east_1
  name        = "percy-main-shared-iam-changes"
  description = "IAM policy / role / user mutation API calls (delivered to us-east-1)"

  event_pattern = jsonencode({
    source        = ["aws.iam"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["iam.amazonaws.com"]
      eventName = [
        "CreatePolicy",
        "DeletePolicy",
        "CreatePolicyVersion",
        "DeletePolicyVersion",
        "AttachUserPolicy",
        "AttachRolePolicy",
        "AttachGroupPolicy",
        "DetachUserPolicy",
        "DetachRolePolicy",
        "DetachGroupPolicy",
        "PutUserPolicy",
        "PutRolePolicy",
        "PutGroupPolicy",
        "DeleteUserPolicy",
        "DeleteRolePolicy",
        "DeleteGroupPolicy",
        "CreateUser",
        "DeleteUser",
        "CreateAccessKey",
        "DeleteAccessKey",
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "iam_changes_to_sns" {
  provider  = aws.us_east_1
  rule      = aws_cloudwatch_event_rule.iam_changes.name
  target_id = "sns"
  arn       = aws_sns_topic.security_events_us_east_1.arn
}

# Allow EventBridge in us-east-1 to publish to the us-east-1 topic.
data "aws_iam_policy_document" "security_events_us_east_1_topic" {
  provider = aws.us_east_1
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.security_events_us_east_1.arn]
  }
}

resource "aws_sns_topic_policy" "security_events_us_east_1" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.security_events_us_east_1.arn
  policy   = data.aws_iam_policy_document.security_events_us_east_1_topic.json
}
