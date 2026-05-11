# Production Environment
# Calls reusable modules with production-sized values.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.18"
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

# us-east-1 provider — required for CloudFront and Route 53 metrics
# (both surface in us-east-1 only) and for any CloudFront-namespace
# CloudWatch alarms.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ---------------------------------------------------------------------------
# Tailscale provider — auth via OAuth client stored in Secrets Manager
# (manually created in the Tailscale admin console with scopes: Policy File
# write + OAuth Keys write, and tag ownership of tag:subnet-router so it can
# delegate that tag to the router's OAuth client)
# ---------------------------------------------------------------------------

data "aws_secretsmanager_secret_version" "tailscale_terraform_oauth" {
  secret_id = "percy-main-production/tailscale/terraform-oauth"
}

locals {
  tailscale_tf_creds = jsondecode(data.aws_secretsmanager_secret_version.tailscale_terraform_oauth.secret_string)
}

# ---------------------------------------------------------------------------
# Google Ads API credentials (recruit-2026 offline conversion uploads).
# Created out-of-band via the AWS CLI (see
# plans/ad-campaign-mk1/ops/01-ads-account-setup.md step 6) - the refresh
# token has its own rotation cadence that doesn't fit cleanly into a
# Terraform resource lifecycle. This data block just lets the ECS task
# definition reference the JSON keys inside the secret.
# ---------------------------------------------------------------------------

data "aws_secretsmanager_secret" "google_ads" {
  name = "percy-main/google-ads"
}

provider "tailscale" {
  oauth_client_id     = local.tailscale_tf_creds.client_id
  oauth_client_secret = local.tailscale_tf_creds.client_secret
  tailnet             = "-" # "-" = the tailnet owned by the authenticated client
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

  # Reliability alarms SNS topic in us-east-1 (added by #211 fixup).
  # try() lets PR plans pass before the shared layer has been re-applied
  # with this new output. The deploy chain on main applies
  # terraform-shared before terraform-production, so by apply time on
  # main the output exists. Until then, the affected alarms have an
  # empty action list — they'll evaluate but won't notify.
  reliability_alarms_topic_arn_us_east_1 = try(
    data.terraform_remote_state.shared.outputs.reliability_alarms_topic_arn_us_east_1,
    null
  )
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
  source                    = "../../modules/rds"
  environment               = "production"
  instance_class            = "db.t4g.micro"
  allocated_storage         = 20
  multi_az                  = false
  vpc_id                    = module.vpc.vpc_id
  private_subnet_ids        = module.vpc.private_subnet_ids
  security_group_id         = module.vpc.rds_security_group_id
  enable_event_subscription = true
}

# ---------------------------------------------------------------------------
# Application (ECS Fargate)
# ---------------------------------------------------------------------------

module "ecs" {
  source                   = "../../modules/ecs-service"
  environment              = "production"
  task_count               = 1
  max_task_count           = 4
  cpu                      = 256
  memory                   = 512
  ecr_repository_url       = local.shared.ecr_repository_url
  acm_certificate_arn      = local.shared.acm_alb_certificate_arn
  vpc_id                   = module.vpc.vpc_id
  private_subnet_ids       = module.vpc.public_subnet_ids
  public_subnet_ids        = module.vpc.public_subnet_ids
  ecs_security_group_id    = module.vpc.ecs_security_group_id
  alb_security_group_id    = module.vpc.alb_security_group_id
  # HOTFIX 2026-05-11: temporarily reverted to /health (pairs with #275
  # R53 revert). The /health/ready route only exists in API commits
  # >= b37094b, and the production API has been stuck on the May 7 image
  # since b37094b's deploy failed at terraform-shared and never recovered
  # (Trivy now flags ~30 deps + a Stripe-pattern placeholder in
  # generate-openapi.js, fixed in #281). Result: ALB polls
  # /health/ready, gets 404 from old code, both targets unhealthy,
  # HTTPCode_ELB_5XX_Count alarm fires. Restore /health/ready once
  # the API is on a build that serves it.
  health_check_path        = "/health"
  log_retention_days       = 30
  assign_public_ip         = true
  ses_identity_arn         = local.shared.ses_identity_arn
  newrelic_license_key_arn = "${aws_secretsmanager_secret.app_secrets.arn}:NEW_RELIC_LICENSE_KEY::"
  enable_nri_ecs_alarm     = true

  documents_bucket_arn                = module.documents_bucket.bucket_arn
  document_uploads_bucket_arn         = module.document_uploads.bucket_arn
  scout_reports_bucket_arn            = module.scout_reports.bucket_arn
  scout_attachment_uploads_bucket_arn = module.scout_attachment_uploads.bucket_arn
  scout_attachments_bucket_arn        = module.scout_attachments_bucket.bucket_arn
  scout_kb_uploads_bucket_arn         = module.scout_kb_uploads.bucket_arn
  scout_kb_bucket_arn                 = module.scout_kb_bucket.bucket_arn

  environment_variables = {
    NODE_ENV                        = "production"
    PORT                            = "3000"
    HOST                            = "0.0.0.0"
    LOG_LEVEL                       = "info"
    EMAIL_PROVIDER                  = "ses"
    SES_REGION                      = "eu-west-2"
    S3_BUCKET                       = "percy-main-production-uploads"
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
    # Scout model config — required, no in-code defaults. Production
    # uses deepseek-v4 (not flash) for the report agent — favours
    # quality over latency on the long generate_report loop.
    SCOUT_PROVIDER_CHAT           = "deepseek"
    SCOUT_PROVIDER_SUBAGENT       = "deepseek"
    SCOUT_PROVIDER_DB             = "anthropic"
    SCOUT_PROVIDER_REPORT         = "deepseek"
    SCOUT_MODEL_CHAT              = "deepseek-v4-pro"
    SCOUT_MODEL_SUBAGENT          = "deepseek-v4-pro"
    SCOUT_MODEL_DB                = "claude-haiku-4-5-20251001"
    SCOUT_MODEL_REPORT            = "deepseek-v4"
    SCOUT_ATTACHMENT_DERIVE_MODEL = "claude-haiku-4-5-20251001"
    VOYAGE_EMBED_MODEL            = "voyage-4"
    VOYAGE_RERANK_MODEL           = "rerank-2.5"
    AWS_REGION                    = "eu-west-2"
    # Cannot reference module.ecs.* outputs that depend on the task definition
    # here — that would cycle through the env-vars input. The cluster and family
    # names are deterministic from the environment, so inline them.
    SYNC_ECS_CLUSTER          = "percy-main-production-cluster"
    SYNC_ECS_TASK_DEFINITION  = "production-api"
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
    # ResultsVault shared secret used by the BBB ingest hook in
    # sync-runner. Optional: if the JSON key is missing or empty, the
    # ingest is skipped and the PC sync runs unchanged.
    RV_SHARED_SECRET  = "${aws_secretsmanager_secret.app_secrets.arn}:RV_SHARED_SECRET::"
    SLACK_WEBHOOK_URL = "${aws_secretsmanager_secret.app_secrets.arn}:SLACK_WEBHOOK_URL::"

    # Scout (alex-only AI cricket analyst). All keys must be populated in
    # the app_secrets blob before this redeploys; the streaming route
    # returns 503 cleanly if the key for an active provider is missing,
    # and Scout boots without VOYAGE_API_KEY but with no fact memory
    # (fact_record / fact_retrieve / cite_fact tools omitted, no
    # auto-retrieval). SCOUT_DB_URL must use the scout_readonly role
    # (created NOLOGIN by migration 2026-05-03; password set out-of-band
    # on the RDS instance). DEEPSEEK_API_KEY is wired so the SCOUT_PROVIDER_*
    # env vars can be flipped to "deepseek" without a code change; the
    # secret JSON key MUST exist in app_secrets (even if empty) before
    # this task definition redeploys, or ECS will fail to start.
    ANTHROPIC_API_KEY = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::"
    DEEPSEEK_API_KEY  = "${aws_secretsmanager_secret.app_secrets.arn}:DEEPSEEK_API_KEY::"
    VOYAGE_API_KEY    = "${aws_secretsmanager_secret.app_secrets.arn}:VOYAGE_API_KEY::"
    SCOUT_DB_URL      = "${aws_secretsmanager_secret.app_secrets.arn}:SCOUT_DB_URL::"

    # Google Ads API (offline conversion uploads — recruit-2026 + future
    # campaigns). Stored in a separate secret from app_secrets so the
    # OAuth refresh token can be rotated independently when it ages out.
    # The IAM allow on `*percy-main*` already covers this secret.
    GOOGLE_ADS_DEVELOPER_TOKEN     = "${data.aws_secretsmanager_secret.google_ads.arn}:developerToken::"
    GOOGLE_ADS_CUSTOMER_ID         = "${data.aws_secretsmanager_secret.google_ads.arn}:customerId::"
    GOOGLE_ADS_LOGIN_CUSTOMER_ID   = "${data.aws_secretsmanager_secret.google_ads.arn}:loginCustomerId::"
    GOOGLE_ADS_OAUTH_CLIENT_ID     = "${data.aws_secretsmanager_secret.google_ads.arn}:clientId::"
    GOOGLE_ADS_OAUTH_CLIENT_SECRET = "${data.aws_secretsmanager_secret.google_ads.arn}:clientSecret::"
    GOOGLE_ADS_OAUTH_REFRESH_TOKEN = "${data.aws_secretsmanager_secret.google_ads.arn}:refreshToken::"

    # SSM Parameter Store (non-secret config)
    BASE_URL             = aws_ssm_parameter.base_url.arn
    API_BASE_URL         = aws_ssm_parameter.api_base_url.arn
    BETTER_AUTH_RP_ID    = aws_ssm_parameter.better_auth_rp_id.arn
    BETTER_AUTH_RP_NAME  = aws_ssm_parameter.better_auth_rp_name.arn
    PLAY_CRICKET_SITE_ID = aws_ssm_parameter.play_cricket_site_id.arn
    SES_FROM_ADDRESS     = aws_ssm_parameter.ses_from_address.arn
  }
}

# ---------------------------------------------------------------------------
# Documents Bucket — S3 (Object Lock, no CloudFront)
# ---------------------------------------------------------------------------

module "documents_bucket" {
  source      = "../../modules/documents-bucket"
  environment = "production"
}

module "document_uploads" {
  source      = "../../modules/document-uploads"
  environment = "production"
  domain_name = var.domain_name
}

# ---------------------------------------------------------------------------
# Scout Reports Bucket — S3 (no CloudFront, signed URLs only)
# ---------------------------------------------------------------------------

module "scout_reports" {
  source      = "../../modules/scout-reports"
  environment = "production"
}

# ---------------------------------------------------------------------------
# Scout Attachment Buckets — uploads (24h lifecycle, CORS PUT) + permanent
# ---------------------------------------------------------------------------

module "scout_attachment_uploads" {
  source      = "../../modules/scout-attachment-uploads"
  environment = "production"
  domain_name = var.domain_name
}

module "scout_attachments_bucket" {
  source      = "../../modules/scout-attachments-bucket"
  environment = "production"
}

# ---------------------------------------------------------------------------
# Scout KB Buckets — uploads (24h lifecycle, CORS PUT) + permanent
# ---------------------------------------------------------------------------

module "scout_kb_uploads" {
  source      = "../../modules/scout-kb-uploads"
  environment = "production"
  domain_name = var.domain_name
}

module "scout_kb_bucket" {
  source      = "../../modules/scout-kb-bucket"
  environment = "production"
}

# ---------------------------------------------------------------------------
# CDN (CloudFront)
# ---------------------------------------------------------------------------

module "cdn" {
  source              = "../../modules/cdn"
  environment         = "production"
  domain_name         = var.domain_name
  acm_certificate_arn = local.shared.acm_cloudfront_certificate_arn
  extra_aliases       = ["www.percymain.org", "kit.percymain.org"]
  api_base_url        = "https://api.v2.percymain.org"
}

# CloudFront CloudWatch alarms — metrics live in us-east-1 only, so the
# alarms must be provisioned with the us_east_1 provider. Routed to the
# shared us-east-1 reliability alarms topic (operator-subscribed).
resource "aws_cloudwatch_metric_alarm" "cdn_5xx_rate" {
  provider = aws.us_east_1

  alarm_name          = "percy-main-production-cdn-5xx-rate"
  alarm_description   = "CloudFront 5xx error rate >1% — origin (ALB → API) is failing or edge layer is misbehaving"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = module.cdn.distribution_id
    Region         = "Global"
  }

  alarm_actions = compact([local.reliability_alarms_topic_arn_us_east_1])
  ok_actions    = compact([local.reliability_alarms_topic_arn_us_east_1])
}

resource "aws_cloudwatch_metric_alarm" "cdn_origin_latency" {
  provider = aws.us_east_1

  alarm_name          = "percy-main-production-cdn-origin-latency"
  alarm_description   = "CloudFront OriginLatency p99 >2s — slow origin (ALB → API) responses, may indicate API saturation"
  namespace           = "AWS/CloudFront"
  metric_name         = "OriginLatency"
  extended_statistic  = "p99"
  period              = 300
  evaluation_periods  = 3
  threshold           = 2000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = module.cdn.distribution_id
    Region         = "Global"
  }

  alarm_actions = compact([local.reliability_alarms_topic_arn_us_east_1])
  ok_actions    = compact([local.reliability_alarms_topic_arn_us_east_1])
}

resource "aws_cloudwatch_metric_alarm" "cdn_cache_hit_rate" {
  provider = aws.us_east_1

  alarm_name          = "percy-main-production-cdn-cache-hit-rate"
  alarm_description   = "CloudFront cache hit rate <80% — regression in cache config or sudden uncached traffic pattern. CacheHitRate requires additional metrics to be enabled on the distribution."
  namespace           = "AWS/CloudFront"
  metric_name         = "CacheHitRate"
  statistic           = "Average"
  period              = 3600
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = module.cdn.distribution_id
    Region         = "Global"
  }

  alarm_actions = compact([local.reliability_alarms_topic_arn_us_east_1])
  ok_actions    = compact([local.reliability_alarms_topic_arn_us_east_1])
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
  # 50 GiB cap (must match `max_allocated_storage` on the RDS module —
  # default 50 in modules/rds/main.tf). Drives the percentage-based
  # storage alarm.
  rds_max_allocated_storage_bytes = 50 * 1024 * 1024 * 1024
}

# ---------------------------------------------------------------------------
# Tailscale Subnet Router — admin DB access
# Advertises the VPC CIDR to the tailnet. See docs/adrs/ for bootstrap steps.
# ---------------------------------------------------------------------------

module "tailscale_router" {
  source           = "../../modules/tailscale-router"
  environment      = "production"
  vpc_id           = module.vpc.vpc_id
  public_subnet_id = module.vpc.public_subnet_ids[0]
  advertise_cidr   = "10.0.0.0/16"
  enable_alarms    = true
}

# Allow admins on the tailnet (via the router) to reach RDS
resource "aws_security_group_rule" "rds_ingress_from_tailscale" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = module.tailscale_router.security_group_id
  security_group_id        = module.vpc.rds_security_group_id
  description              = "PostgreSQL from Tailscale subnet router (admin access)"
}

# Tailscale ACL — who can reach what over the tailnet
resource "tailscale_acl" "main" {
  acl = jsonencode({
    tagOwners = {
      "tag:subnet-router" = ["autogroup:admin"]
    }
    groups = {
      "group:db-admins" = var.tailscale_db_admins
    }
    autoApprovers = {
      routes = {
        "10.0.0.0/16" = ["tag:subnet-router"]
      }
    }
    acls = [
      {
        action = "accept"
        src    = ["group:db-admins"]
        dst    = ["10.0.128.0/23:5432"]
      }
    ]
  })
}

# Subnet-router OAuth client — minted under terraform so its secret flows
# straight into the Secrets Manager placeholder the module creates.
resource "tailscale_oauth_client" "subnet_router" {
  description = "percy-main production subnet router"
  scopes      = ["auth_keys"]
  tags        = ["tag:subnet-router"]
}

resource "aws_secretsmanager_secret_version" "tailscale_auth" {
  secret_id     = module.tailscale_router.auth_secret_arn
  secret_string = tailscale_oauth_client.subnet_router.key
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
  alarms_sns_topic_arn    = module.monitoring.sns_topic_arn
  log_group_name          = module.ecs.log_group_name
}
