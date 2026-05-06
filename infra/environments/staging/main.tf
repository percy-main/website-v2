# Staging Environment
# Same modules as production, smaller values.
# Key differences: no NAT gateway (tasks in public subnets with public IP),
# single task, shorter log retention.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment after bootstrap
  # backend "s3" {
  #   bucket         = "percy-main-terraform-state-bucket"
  #   key            = "staging/terraform.tfstate"
  #   region         = "eu-west-2"
  #   dynamodb_table = "percy-main-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = "eu-west-2"
}

# -----------------------------------------------------------------------------
# Remote State — Shared Resources
# -----------------------------------------------------------------------------

data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "percy-main-terraform-state-bucket"
    key    = "shared/terraform.tfstate"
    region = "eu-west-2"
  }
}

locals {
  shared = data.terraform_remote_state.shared.outputs
}

# -----------------------------------------------------------------------------
# VPC
# -----------------------------------------------------------------------------

module "vpc" {
  source             = "../../modules/vpc"
  environment        = "staging"
  cidr_block         = "10.1.0.0/16"
  enable_nat_gateway = false
}

# -----------------------------------------------------------------------------
# RDS
# -----------------------------------------------------------------------------

module "rds" {
  source             = "../../modules/rds"
  environment        = "staging"
  instance_class     = "db.t4g.micro"
  allocated_storage  = 20
  multi_az           = false
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.rds_security_group_id
}

# -----------------------------------------------------------------------------
# ECS — API Service
# No NAT gateway, so tasks run in public subnets with public IP assigned.
# -----------------------------------------------------------------------------

module "ecs" {
  source                = "../../modules/ecs-service"
  environment           = "staging"
  task_count            = 1
  max_task_count        = 2
  cpu                   = 256
  memory                = 512
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.public_subnet_ids
  public_subnet_ids     = module.vpc.public_subnet_ids
  ecs_security_group_id = module.vpc.ecs_security_group_id
  alb_security_group_id = module.vpc.alb_security_group_id
  ecr_repository_url    = local.shared.ecr_repository_url
  acm_certificate_arn   = local.shared.acm_alb_certificate_arn
  log_retention_days    = 30
  assign_public_ip      = true
  ses_identity_arn      = local.shared.ses_identity_arn

  documents_bucket_arn                = module.documents_bucket.bucket_arn
  document_uploads_bucket_arn         = module.document_uploads.bucket_arn
  scout_reports_bucket_arn            = module.scout_reports.bucket_arn
  scout_attachment_uploads_bucket_arn = module.scout_attachment_uploads.bucket_arn
  scout_attachments_bucket_arn        = module.scout_attachments_bucket.bucket_arn
  scout_kb_uploads_bucket_arn         = module.scout_kb_uploads.bucket_arn
  scout_kb_bucket_arn                 = module.scout_kb_bucket.bucket_arn

  environment_variables = {
    NODE_ENV                        = "staging"
    PORT                            = "3000"
    HOST                            = "0.0.0.0"
    LOG_LEVEL                       = "info"
    EMAIL_PROVIDER                  = "ses"
    SES_REGION                      = "eu-west-2"
    S3_BUCKET                       = "percy-main-staging-uploads"
    S3_REGION                       = "eu-west-2"
    S3_RECEIPT_PREFIX               = "receipts"
    S3_DOCUMENTS_BUCKET             = module.documents_bucket.bucket_name
    S3_DOCUMENTS_PREFIX             = "documents"
    S3_DOCUMENT_UPLOADS_BUCKET      = module.document_uploads.bucket_name
    SCOUT_REPORTS_BUCKET            = module.scout_reports.bucket_name
    SCOUT_ATTACHMENT_UPLOADS_BUCKET = module.scout_attachment_uploads.bucket_name
    SCOUT_ATTACHMENTS_BUCKET        = module.scout_attachments_bucket.bucket_name
    SCOUT_ATTACHMENTS_PREFIX        = "scout/attachments"
    SCOUT_KB_UPLOADS_BUCKET         = module.scout_kb_uploads.bucket_name
    SCOUT_KB_BUCKET                 = module.scout_kb_bucket.bucket_name
    SCOUT_KB_PREFIX                 = "scout/knowledge"
    # Scout model config — required, no in-code defaults. Mirror local
    # dev so staging behaves the same. Production tracks staging
    # exactly except SCOUT_MODEL_REPORT, which uses deepseek-v4 (not
    # flash) to favour quality over latency on report runs.
    SCOUT_PROVIDER_CHAT           = "deepseek"
    SCOUT_PROVIDER_SUBAGENT       = "deepseek"
    SCOUT_PROVIDER_DB             = "anthropic"
    SCOUT_PROVIDER_REPORT         = "deepseek"
    SCOUT_MODEL_CHAT              = "deepseek-v4-pro"
    SCOUT_MODEL_SUBAGENT          = "deepseek-v4-pro"
    SCOUT_MODEL_DB                = "claude-haiku-4-5-20251001"
    SCOUT_MODEL_REPORT            = "deepseek-v4-flash"
    SCOUT_ATTACHMENT_DERIVE_MODEL = "claude-haiku-4-5-20251001"
    VOYAGE_EMBED_MODEL            = "voyage-4"
    VOYAGE_RERANK_MODEL           = "rerank-2.5"
    AWS_REGION                    = "eu-west-2"
    # Cannot reference module.ecs.* outputs that depend on the task definition
    # here — that would cycle through the env-vars input. The cluster and family
    # names are deterministic from the environment, so inline them.
    SYNC_ECS_CLUSTER          = "percy-main-staging-cluster"
    SYNC_ECS_TASK_DEFINITION  = "staging-api"
    SYNC_ECS_SUBNETS          = join(",", module.vpc.public_subnet_ids)
    SYNC_ECS_SECURITY_GROUP   = module.vpc.ecs_security_group_id
    SYNC_ECS_ASSIGN_PUBLIC_IP = "true"
  }

  secrets = {
    # Secrets Manager (actual secrets)
    DATABASE_URL           = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::"
    BETTER_AUTH_SECRET     = "${aws_secretsmanager_secret.app_secrets.arn}:BETTER_AUTH_SECRET::"
    BETTER_AUTH_API_KEY    = "${aws_secretsmanager_secret.app_secrets.arn}:BETTER_AUTH_API_KEY::"
    STRIPE_SECRET_KEY      = "${aws_secretsmanager_secret.app_secrets.arn}:STRIPE_SECRET_KEY::"
    STRIPE_WEBHOOK_SECRET  = "${aws_secretsmanager_secret.app_secrets.arn}:STRIPE_WEBHOOK_SECRET::"
    GOOGLE_CLIENT_ID       = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_ID::"
    GOOGLE_CLIENT_SECRET   = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_SECRET::"
    PLAY_CRICKET_API_TOKEN = "${aws_secretsmanager_secret.app_secrets.arn}:PLAY_CRICKET_API_TOKEN::"
    SLACK_WEBHOOK_URL      = "${aws_secretsmanager_secret.app_secrets.arn}:SLACK_WEBHOOK_URL::"

    # Scout (alex-only AI cricket analyst). All keys must be populated in
    # the app_secrets blob before this redeploys; Scout boots without
    # VOYAGE_API_KEY but the fact_record / fact_retrieve / cite_fact
    # tools and the auto-retrieved <known-facts> block are all silently
    # omitted in that case. SCOUT_DB_URL must use the scout_readonly
    # role (created NOLOGIN by migration 2026-05-03; password set
    # out-of-band on the RDS instance). DEEPSEEK_API_KEY is wired so the
    # SCOUT_PROVIDER_* env vars can be flipped to "deepseek" without a
    # code change; the secret JSON key MUST exist in app_secrets (even
    # if empty) before this task definition redeploys, or ECS will fail
    # to start.
    ANTHROPIC_API_KEY = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::"
    DEEPSEEK_API_KEY  = "${aws_secretsmanager_secret.app_secrets.arn}:DEEPSEEK_API_KEY::"
    VOYAGE_API_KEY    = "${aws_secretsmanager_secret.app_secrets.arn}:VOYAGE_API_KEY::"
    SCOUT_DB_URL      = "${aws_secretsmanager_secret.app_secrets.arn}:SCOUT_DB_URL::"

    # SSM Parameter Store (non-secret config)
    BASE_URL             = aws_ssm_parameter.base_url.arn
    API_BASE_URL         = aws_ssm_parameter.api_base_url.arn
    BETTER_AUTH_RP_ID    = aws_ssm_parameter.better_auth_rp_id.arn
    BETTER_AUTH_RP_NAME  = aws_ssm_parameter.better_auth_rp_name.arn
    PLAY_CRICKET_SITE_ID = aws_ssm_parameter.play_cricket_site_id.arn
    SES_FROM_ADDRESS     = aws_ssm_parameter.ses_from_address.arn
  }
}

# -----------------------------------------------------------------------------
# Documents Bucket — S3 (Object Lock, no CloudFront)
# -----------------------------------------------------------------------------

module "documents_bucket" {
  source      = "../../modules/documents-bucket"
  environment = "staging"
}

module "document_uploads" {
  source      = "../../modules/document-uploads"
  environment = "staging"
  domain_name = "staging.${var.domain_name}"
}

# -----------------------------------------------------------------------------
# Scout Reports Bucket — S3 (no CloudFront, signed URLs only)
# -----------------------------------------------------------------------------

module "scout_reports" {
  source      = "../../modules/scout-reports"
  environment = "staging"
}

# -----------------------------------------------------------------------------
# Scout Attachment Buckets — uploads (24h lifecycle, CORS PUT) + permanent
# -----------------------------------------------------------------------------

module "scout_attachment_uploads" {
  source      = "../../modules/scout-attachment-uploads"
  environment = "staging"
  domain_name = "staging.${var.domain_name}"
}

module "scout_attachments_bucket" {
  source      = "../../modules/scout-attachments-bucket"
  environment = "staging"
}

# -----------------------------------------------------------------------------
# Scout KB Buckets — uploads (24h lifecycle, CORS PUT) + permanent
# -----------------------------------------------------------------------------

module "scout_kb_uploads" {
  source      = "../../modules/scout-kb-uploads"
  environment = "staging"
  domain_name = "staging.${var.domain_name}"
}

module "scout_kb_bucket" {
  source      = "../../modules/scout-kb-bucket"
  environment = "staging"
}

# -----------------------------------------------------------------------------
# CDN — CloudFront + S3
# -----------------------------------------------------------------------------

module "cdn" {
  source              = "../../modules/cdn"
  environment         = "staging"
  domain_name         = "staging.${var.domain_name}"
  acm_certificate_arn = local.shared.acm_cloudfront_certificate_arn
  alb_dns_name        = module.ecs.alb_dns_name
  api_base_url        = "https://api.staging.${var.domain_name}"
}

# -----------------------------------------------------------------------------
# DNS — Route 53 Records
# -----------------------------------------------------------------------------

module "dns" {
  source                    = "../../modules/dns"
  zone_id                   = local.shared.zone_id
  domain_name               = "staging.${var.domain_name}"
  alb_dns_name              = module.ecs.alb_dns_name
  alb_zone_id               = module.ecs.alb_zone_id
  cloudfront_domain_name    = module.cdn.distribution_domain_name
  cloudfront_hosted_zone_id = module.cdn.distribution_hosted_zone_id
}

# -----------------------------------------------------------------------------
# Monitoring — CloudWatch Alarms + Dashboard
# -----------------------------------------------------------------------------

module "monitoring" {
  source                  = "../../modules/monitoring"
  environment             = "staging"
  alarm_email             = var.alarm_email
  cluster_name            = module.ecs.cluster_name
  service_name            = module.ecs.service_name
  alb_arn_suffix          = module.ecs.alb_arn_suffix
  target_group_arn_suffix = module.ecs.target_group_arn_suffix
  rds_instance_id         = module.rds.instance_id
}

# -----------------------------------------------------------------------------
# Scheduling — EventBridge Play Cricket Sync
# No NAT gateway, so scheduled tasks also run in public subnets.
# -----------------------------------------------------------------------------

module "scheduling" {
  source                  = "../../modules/scheduling"
  environment             = "staging"
  cluster_arn             = module.ecs.cluster_arn
  task_definition_arn     = module.ecs.task_definition_arn
  subnet_ids              = module.vpc.public_subnet_ids
  security_group_id       = module.vpc.ecs_security_group_id
  task_execution_role_arn = module.ecs.task_execution_role_arn
  task_role_arn           = module.ecs.task_role_arn
  assign_public_ip        = true
  alarms_sns_topic_arn    = module.monitoring.sns_topic_arn
  log_group_name          = module.ecs.log_group_name
}

