# Application secrets — stored as a single JSON object in Secrets Manager.
# Populated manually before first deploy with the following keys:
#   DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_API_KEY, STRIPE_SECRET_KEY,
#   STRIPE_WEBHOOK_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#   PLAY_CRICKET_API_TOKEN, SLACK_WEBHOOK_URL,
#   ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, VOYAGE_API_KEY, TAVILY_API_KEY,
#   SCOUT_DB_URL, MCP_DB_URL, PHOENIX_API_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "production/percy-main/app"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# SSM Parameter Store — non-secret config
# Values are set via AWS CLI after initial creation:
#   aws ssm put-parameter --name "/production/percy-main/<KEY>" --value "<VALUE>" --overwrite
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "base_url" {
  name  = "/production/percy-main/BASE_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "api_base_url" {
  name  = "/production/percy-main/API_BASE_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "better_auth_rp_id" {
  name  = "/production/percy-main/BETTER_AUTH_RP_ID"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "better_auth_rp_name" {
  name  = "/production/percy-main/BETTER_AUTH_RP_NAME"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "play_cricket_site_id" {
  name  = "/production/percy-main/PLAY_CRICKET_SITE_ID"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "ses_from_address" {
  name  = "/production/percy-main/SES_FROM_ADDRESS"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# ── Cross-subdomain auth for matchday.percymain.org ──
#
# These three drive better-auth's cross-subdomain session cookie + the
# API's CORS allowlist. Set their actual values via the AWS CLI after
# Terraform creates the placeholders:
#
#   aws --profile percy-main ssm put-parameter --overwrite \
#     --name /production/percy-main/MATCHDAY_URL \
#     --value "https://matchday.percymain.org"
#   aws --profile percy-main ssm put-parameter --overwrite \
#     --name /production/percy-main/WWW_URL \
#     --value "https://www.percymain.org"
#   aws --profile percy-main ssm put-parameter --overwrite \
#     --name /production/percy-main/COOKIE_DOMAIN \
#     --value ".percymain.org"
#
# Until COOKIE_DOMAIN is set, the API runs single-origin (existing
# behaviour); matchday.percymain.org will be CORS-blocked on auth.
# Once set, the session cookie is scoped to all *.percymain.org so
# matchday + www + apex share the session.

resource "aws_ssm_parameter" "matchday_url" {
  name  = "/production/percy-main/MATCHDAY_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "www_url" {
  name  = "/production/percy-main/WWW_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "cookie_domain" {
  name  = "/production/percy-main/COOKIE_DOMAIN"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# Web Push (VAPID) public key. The private half + subject live in the
# app_secrets blob (Secrets Manager). Generate the keypair once with
# `npx web-push generate-vapid-keys` and set both halves before the API
# first redeploys with the push code wired in - the API fails fast at
# boot if any of the three are missing.
#
#   aws --profile percy-main ssm put-parameter --overwrite \
#     --name /production/percy-main/VAPID_PUBLIC_KEY \
#     --value "<public key from web-push generate-vapid-keys>"
resource "aws_ssm_parameter" "vapid_public_key" {
  name  = "/production/percy-main/VAPID_PUBLIC_KEY"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "production"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
