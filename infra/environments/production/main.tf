# Production Environment
# Calls reusable modules with production-sized values.

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
    key            = "production/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "percy-main-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "eu-west-2"
}

# ---------------------------------------------------------------------------
# Remote state — shared infrastructure outputs
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

module "vpc" {
  source             = "../../modules/vpc"
  environment        = "production"
  cidr_block         = "10.0.0.0/16"
  enable_nat_gateway = false
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

module "rds" {
  source             = "../../modules/rds"
  environment        = "production"
  instance_class     = "db.t4g.micro"
  allocated_storage  = 20
  multi_az           = false
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.rds_security_group_id
}

# ---------------------------------------------------------------------------
# Application (ECS Fargate)
# ---------------------------------------------------------------------------

module "ecs" {
  source                = "../../modules/ecs-service"
  environment           = "production"
  task_count            = 1
  max_task_count        = 4
  cpu                   = 256
  memory                = 512
  ecr_repository_url    = local.shared.ecr_repository_url
  acm_certificate_arn   = local.shared.acm_alb_certificate_arn
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.public_subnet_ids
  public_subnet_ids     = module.vpc.public_subnet_ids
  ecs_security_group_id = module.vpc.ecs_security_group_id
  alb_security_group_id = module.vpc.alb_security_group_id
  health_check_path     = "/health"
  log_retention_days    = 30
  assign_public_ip      = true
  ses_identity_arn      = local.shared.ses_identity_arn

  environment_variables = {
    NODE_ENV       = "production"
    PORT           = "3000"
    HOST           = "0.0.0.0"
    LOG_LEVEL      = "info"
    EMAIL_PROVIDER = "ses"
    SES_REGION     = "eu-west-2"
  }

  secrets = {
    DATABASE_URL           = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::"
    BETTER_AUTH_SECRET     = "${aws_secretsmanager_secret.app_secrets.arn}:BETTER_AUTH_SECRET::"
    STRIPE_SECRET_KEY      = "${aws_secretsmanager_secret.app_secrets.arn}:STRIPE_SECRET_KEY::"
    STRIPE_WEBHOOK_SECRET  = "${aws_secretsmanager_secret.app_secrets.arn}:STRIPE_WEBHOOK_SECRET::"
    GOOGLE_CLIENT_ID       = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_ID::"
    GOOGLE_CLIENT_SECRET   = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_SECRET::"
    PLAY_CRICKET_API_TOKEN = "${aws_secretsmanager_secret.app_secrets.arn}:PLAY_CRICKET_API_TOKEN::"
    PLAY_CRICKET_SITE_ID   = "${aws_secretsmanager_secret.app_secrets.arn}:PLAY_CRICKET_SITE_ID::"
    SLACK_WEBHOOK_URL      = "${aws_secretsmanager_secret.app_secrets.arn}:SLACK_WEBHOOK_URL::"
    BASE_URL               = "${aws_secretsmanager_secret.app_secrets.arn}:BASE_URL::"
    BETTER_AUTH_RP_ID      = "${aws_secretsmanager_secret.app_secrets.arn}:BETTER_AUTH_RP_ID::"
    BETTER_AUTH_RP_NAME    = "${aws_secretsmanager_secret.app_secrets.arn}:BETTER_AUTH_RP_NAME::"
    SES_FROM_ADDRESS       = "${aws_secretsmanager_secret.app_secrets.arn}:SES_FROM_ADDRESS::"
  }
}

# ---------------------------------------------------------------------------
# CDN (CloudFront)
# ---------------------------------------------------------------------------

module "cdn" {
  source              = "../../modules/cdn"
  environment         = "production"
  domain_name         = var.domain_name
  acm_certificate_arn = local.shared.acm_cloudfront_certificate_arn
  extra_aliases       = ["kit.percymain.org"]
}

# ---------------------------------------------------------------------------
# DNS (Route 53) — only api.v2 record needed; percymain.org DNS is at Netlify
# ---------------------------------------------------------------------------

resource "aws_route53_record" "api_v2_a" {
  zone_id = local.shared.zone_id
  name    = "api.v2.percymain.org"
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_v2_aaaa" {
  zone_id = local.shared.zone_id
  name    = "api.v2.percymain.org"
  type    = "AAAA"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Monitoring & Alerting
# ---------------------------------------------------------------------------

module "monitoring" {
  source                  = "../../modules/monitoring"
  environment             = "production"
  alarm_email             = var.alarm_email
  cluster_name            = module.ecs.cluster_name
  service_name            = module.ecs.service_name
  alb_arn_suffix          = module.ecs.alb_arn_suffix
  target_group_arn_suffix = module.ecs.target_group_arn_suffix
  rds_instance_id         = module.rds.instance_id
}

# ---------------------------------------------------------------------------
# Scheduled Tasks
# ---------------------------------------------------------------------------

module "scheduling" {
  source                  = "../../modules/scheduling"
  environment             = "production"
  cluster_arn             = module.ecs.cluster_arn
  task_definition_arn     = module.ecs.task_definition_arn
  subnet_ids              = module.vpc.public_subnet_ids
  security_group_id       = module.vpc.ecs_security_group_id
  task_execution_role_arn = module.ecs.task_execution_role_arn
  task_role_arn           = module.ecs.task_role_arn
  assign_public_ip        = true
}
