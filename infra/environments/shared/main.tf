terraform {
  # >= 1.7: the removed (forget) blocks below need config-driven state
  # removal, introduced in Terraform 1.7.
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.45"
    }
    # Transitional (#719): the NR provider is still required because state
    # holds the two newrelic_* resources until the removed blocks below
    # apply (forget). The follow-up cleanup PR deletes this entry, the
    # .terraform.lock.hcl entry, the provider block + variables below,
    # and the NR credentials in the workflows once that apply has run.
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.49"
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

# New Relic provider - auth via NEW_RELIC_API_KEY env var (set on the
# CI runner from secrets.NEW_RELIC_API_KEY). Account ID + region come
# from variables so they're declarative rather than env-dependent.
#
# Transitional (#719): CI pins Terraform 1.7, which REFRESHES resources
# targeted by removed/forget blocks, so plan/apply make real NR API
# calls while the two newrelic_* resources remain in state - placeholder
# credentials 401. This block, its variables, and the workflow
# credentials all go in the follow-up cleanup PR once the forget has
# applied.
provider "newrelic" {
  account_id = var.newrelic_account_id
  region     = var.newrelic_region
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
# SES alarms - bounce / complaint / sending-quota.
# AWS auto-pauses sending if BounceRate > 5% or ComplaintRate > 0.1%
# over a rolling window, so these need to page early enough that we
# can intervene before the pause hits.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  alarm_name          = "percy-main-ses-bounce-rate"
  alarm_description   = "SES bounce rate >5% - AWS auto-pauses sending if this stays high. Investigate before pause."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Average"
  period              = 900
  evaluation_periods  = 4
  threshold           = 0.05
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.shared_reliability_alarms.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  alarm_name          = "percy-main-ses-complaint-rate"
  alarm_description   = "SES complaint rate >0.1% - AWS auto-pauses sending if this stays high. Likely a list-hygiene problem."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Average"
  period              = 900
  evaluation_periods  = 4
  threshold           = 0.001
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.shared_reliability_alarms.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms.arn]
}

# Send count is per-account (no dimensions). 24h send count crossing
# 80% of the sandbox/production quota indicates either a campaign
# spike or a runaway loop / compromised endpoint.
resource "aws_cloudwatch_metric_alarm" "ses_send_volume" {
  alarm_name          = "percy-main-ses-send-volume-spike"
  alarm_description   = "SES Send count anomalously high in the last hour - possible runaway loop / compromised endpoint. Threshold is a heuristic; tune after observing normal traffic."
  namespace           = "AWS/SES"
  metric_name         = "Send"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.shared_reliability_alarms.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms.arn]
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
# IAM Role: Terraform Apply (GitHub Actions - main branch only)
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
# IAM Role: Terraform Plan (GitHub Actions - reviewer-gated PR plans + drift)
# Used for plan-only operations: PR plans approved via the terraform-plan
# GitHub environment, and main-branch drift detection.
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
      # Only human-gated or protected-ref subjects (ADR 057, #626):
      #   - environment:terraform-plan - PR plan runs, released only
      #     after a required reviewer approves the run via the GitHub
      #     environment gate. The bare `pull_request` subject was
      #     removed: a real plan reads Terraform state, and state
      #     contains secret values, so a credentialed plan of
      #     unreviewed PR code can exfiltrate secrets no matter how
      #     tightly this role's permission policy is scoped.
      #   - ref:refs/heads/main - scheduled / workflow_dispatch drift
      #     detection (terraform-drift workflow).
      values = [
        "repo:${var.github_repo}:environment:terraform-plan",
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
        Resource = "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table/percy-main-terraform-locks"
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:*percy-main*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# IAM Role: Deploy (GitHub Actions - main branch only)
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
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:cluster/percy-main-*",
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:service/percy-main-*/*",
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task/percy-main-*/*",
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
      # `*-api:*` catches the long-running API service task def
      # (e.g. production-api), `*-api-migrate:*` catches the
      # migration runner task def added in #130 for principle-of-
      # least-privilege role separation.
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/*-api:*",
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/*-api-migrate:*",
    ]
  }

  # ListTasks is required by deploy.yml's rollback-diagnostics step:
  # when ECS rolls back a failed task def, we list STOPPED tasks for the
  # service to find the rolled-forward revision's boot-failed task and
  # tail its CloudWatch log stream into the run summary. Without this,
  # the workflow falls back to "rollback happened, go dig manually".
  #
  # AWS scopes ListTasks to the `container-instance` resource type,
  # which does not apply on Fargate - so the canonical pattern is
  # Resource "*" gated by the `ecs:cluster` condition key. The
  # condition restricts the call to percy-main-* clusters only.
  statement {
    sid    = "ECSListTasks"
    effect = "Allow"
    actions = [
      "ecs:ListTasks",
    ]
    resources = ["*"]
    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values = [
        "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:cluster/percy-main-*",
      ]
    }
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

  # deploy-web pushes the prerenderer Lambda's code (built from the same
  # web bundle it deploys to S3) and kicks a render-all after upload.
  # GetFunctionConfiguration backs `aws lambda wait function-updated`.
  statement {
    sid    = "PrerendererCodeDeploy"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:InvokeFunction",
    ]
    resources = [
      "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:percy-main-*-prerenderer",
    ]
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
      "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:percy-main-*",
    ]
  }
}

resource "aws_iam_role_policy" "deploy_secrets" {
  name   = "secrets-manager-read"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_secrets.json
}

# -----------------------------------------------------------------------------
# ACM Certificate - ALB (eu-west-2)
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
# ACM Certificate - CloudFront (us-east-1)
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
# Reliability alarms - Route 53 health check + ACM expiry
# -----------------------------------------------------------------------------
# Email subscriptions are Terraform-managed (#719 audit found both
# topics had zero subscribers, so every reliability alarm fired into
# the void). The security-events topics remain operator-subscribed out
# of band.
#
# Per-region split: Route 53 health-check metrics + the CloudFront
# certificate live in us-east-1; the ALB certificate lives in
# eu-west-2.

# eu-west-2 reliability alarms topic - ALB cert expiry.
resource "aws_sns_topic" "shared_reliability_alarms" {
  name = "percy-main-shared-reliability-alarms"
  tags = {
    Environment = "shared"
    Module      = "shared"
    ManagedBy   = "terraform"
    Purpose     = "reliability-alarms"
  }
}

# us-east-1 reliability alarms topic - Route 53 health-check + CloudFront cert.
resource "aws_sns_topic" "shared_reliability_alarms_us_east_1" {
  provider = aws.us_east_1
  name     = "percy-main-shared-reliability-alarms"
  tags = {
    Environment = "shared"
    Module      = "shared"
    ManagedBy   = "terraform"
    Purpose     = "reliability-alarms-us-east-1"
  }
}

# Email delivery for both reliability topics. Apply leaves each
# subscription PendingConfirmation until the "Subscription
# Confirmation" email AWS sends to the endpoint is clicked.
resource "aws_sns_topic_subscription" "shared_reliability_alarms_email" {
  topic_arn = aws_sns_topic.shared_reliability_alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_sns_topic_subscription" "shared_reliability_alarms_email_us_east_1" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.shared_reliability_alarms_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Route 53 HTTPS health check on the production API. The check originates
# from R53's globally-distributed checkers, so it catches DNS / TLS /
# edge problems that ALB target health cannot.
resource "aws_route53_health_check" "api" {
  fqdn = "api.v2.${var.domain_name}"
  port = 443
  type = "HTTPS"
  # /health/ready returns 503 on DB outage, so this health check fires
  # the alarm on a real outage rather than just process death (#193).
  resource_path     = "/health/ready"
  request_interval  = 30
  failure_threshold = 3
  measure_latency   = false

  tags = {
    Name        = "percy-main-api-health-check"
    Environment = "shared"
    ManagedBy   = "terraform"
  }
}

# Health-check status metric is published to us-east-1 only.
resource "aws_cloudwatch_metric_alarm" "api_health_check" {
  provider = aws.us_east_1

  alarm_name          = "percy-main-api-route53-health-check"
  alarm_description   = "Route 53 health check failing for api.v2.${var.domain_name} - DNS / TLS / edge problem (independent of ALB target health)"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    HealthCheckId = aws_route53_health_check.api.id
  }

  alarm_actions = [aws_sns_topic.shared_reliability_alarms_us_east_1.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms_us_east_1.arn]
}

# ACM cert expiry - alarm at 30 days. DNS-validated certs auto-renew but
# renewal can fail (DNS records modified, NS delegation broken).
resource "aws_cloudwatch_metric_alarm" "alb_cert_expiry" {
  alarm_name          = "percy-main-alb-cert-expiry"
  alarm_description   = "ALB ACM certificate expires in <30 days - auto-renewal may have failed"
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    CertificateArn = aws_acm_certificate.alb.arn
  }

  alarm_actions = [aws_sns_topic.shared_reliability_alarms.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_cert_expiry" {
  provider = aws.us_east_1

  alarm_name          = "percy-main-cloudfront-cert-expiry"
  alarm_description   = "CloudFront ACM certificate expires in <30 days - auto-renewal may have failed"
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    CertificateArn = aws_acm_certificate.cloudfront.arn
  }

  alarm_actions = [aws_sns_topic.shared_reliability_alarms_us_east_1.arn]
  ok_actions    = [aws_sns_topic.shared_reliability_alarms_us_east_1.arn]
}

# -----------------------------------------------------------------------------
# Security event notifications
# -----------------------------------------------------------------------------
# EventBridge rules that catch security-sensitive API calls (SG changes,
# IAM policy edits) and route them to per-region SNS topics. Topics
# carry no terraform-managed subscription - operators add an email /
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
# `events.amazonaws.com` - only a customer-managed CMK can do that).
# Event payloads are CloudTrail event metadata (no secrets), so leaving
# encryption-at-rest off is an acceptable trade. Add a CMK here if the
# threat model later requires it.

# eu-west-2 topic - receives SG-change events.
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

# us-east-1 topic + IAM rule - IAM API events surface only in us-east-1.
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

# -----------------------------------------------------------------------------
# DB master break-glass role (#130 / ADR 043)
#
# Reading the RDS master credentials secret should be a deliberate,
# audited act - not something the day-to-day admin IAM can do silently.
# Solution: a dedicated IAM role with a single permission
# (`secretsmanager:GetSecretValue` on the master credentials secret).
# Admins assume it via `aws sts assume-role` when they need master;
# the assumption itself is the audit point - every use shows up in
# CloudTrail as an `AssumeRole` on this role, and EventBridge alarms
# fire to the security_events topic.
#
# Trust policy allows any IAM principal in this account that proves
# MFA. We rely on user-side IAM (admin group) to gate who actually
# carries `sts:AssumeRole` perms. Session capped at 1h because
# break-glass should be quick.
# -----------------------------------------------------------------------------

resource "aws_iam_role" "db_break_glass" {
  name                 = "percy-main-db-break-glass"
  description          = "Break-glass access to the RDS master credentials secret. Assumption is the audit point - every use is logged in CloudTrail and alarms to security_events."
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action = "sts:AssumeRole"
        Condition = {
          Bool = {
            "aws:MultiFactorAuthPresent" = "true"
          }
        }
      }
    ]
  })

  tags = {
    Environment = "shared"
    Module      = "shared"
    ManagedBy   = "terraform"
    Purpose     = "db-master-break-glass"
  }
}

# Single permission: read the master credentials secret. Secret ARN
# carries the Secrets-Manager-suffix (`-XXXXXX`) which is created at
# secret-creation time; use a wildcard so this policy doesn't have to
# be rewritten if the secret is ever recreated.
resource "aws_iam_role_policy" "db_break_glass_read_master" {
  name = "read-rds-master-credentials"
  role = aws_iam_role.db_break_glass.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:percy-main-production/rds/credentials-*"
      }
    ]
  })
}

# Alarm on every assumption. STS AssumeRole events land in the region
# where the call was made - admins on this account call regional STS
# endpoints (the post-2019 default) so eu-west-2 is the right home.
# For belt-and-braces (global-endpoint callers, federated console)
# we also wire a us-east-1 rule below.
resource "aws_cloudwatch_event_rule" "db_break_glass_assume" {
  name        = "percy-main-shared-db-break-glass-assumed"
  description = "Someone assumed the DB master break-glass role (#130 / ADR 043)."

  event_pattern = jsonencode({
    source        = ["aws.sts"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["sts.amazonaws.com"]
      eventName   = ["AssumeRole"]
      requestParameters = {
        roleArn = [aws_iam_role.db_break_glass.arn]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "db_break_glass_assume_to_sns" {
  rule      = aws_cloudwatch_event_rule.db_break_glass_assume.name
  target_id = "sns"
  arn       = aws_sns_topic.security_events.arn
}

resource "aws_cloudwatch_event_rule" "db_break_glass_assume_us_east_1" {
  provider    = aws.us_east_1
  name        = "percy-main-shared-db-break-glass-assumed"
  description = "Someone assumed the DB master break-glass role (#130 / ADR 043) via a global / us-east-1 STS endpoint."

  event_pattern = jsonencode({
    source        = ["aws.sts"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["sts.amazonaws.com"]
      eventName   = ["AssumeRole"]
      requestParameters = {
        roleArn = [aws_iam_role.db_break_glass.arn]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "db_break_glass_assume_to_sns_us_east_1" {
  provider  = aws.us_east_1
  rule      = aws_cloudwatch_event_rule.db_break_glass_assume_us_east_1.name
  target_id = "sns"
  arn       = aws_sns_topic.security_events_us_east_1.arn
}


# -----------------------------------------------------------------------------
# New Relic removal (#719)
# -----------------------------------------------------------------------------
# The NR AWS integration ran in PULL mode with no region restriction, so
# NR issued billable GetMetricData calls in every AWS region (~$18/mo).
# CloudWatch + SNS covers our alerting, so New Relic is removed entirely.
#
# The two NR-provider-managed resources are forgotten (dropped from
# state) rather than destroyed: the NR account is being closed out of
# band, which deletes the NR-side link objects regardless, so destroying
# them from Terraform buys nothing. Delete these removed blocks in the
# follow-up cleanup PR once this has applied.

removed {
  from = newrelic_cloud_aws_link_account.main
  lifecycle {
    destroy = false
  }
}

removed {
  from = newrelic_cloud_aws_integrations.main
  lifecycle {
    destroy = false
  }
}
