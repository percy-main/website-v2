# Secrets Manager — Application Secrets
# Stores environment-specific secrets (Stripe keys, OAuth credentials, etc.)
# that are injected into ECS tasks at runtime.
#
# The secret value is managed outside Terraform (via AWS CLI or console).
# Terraform only manages the secret resource itself.
#
# Keys: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_API_KEY, STRIPE_SECRET_KEY,
#       STRIPE_WEBHOOK_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#       PLAY_CRICKET_API_TOKEN, SLACK_WEBHOOK_URL,
#       ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, VOYAGE_API_KEY, TAVILY_API_KEY,
#       SCOUT_DB_URL, MCP_DB_URL, PHOENIX_API_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "staging/percy-main/app"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# SSM Parameter Store — non-secret config
# Values are set via AWS CLI after initial creation:
#   aws ssm put-parameter --name "/staging/percy-main/<KEY>" --value "<VALUE>" --overwrite
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "base_url" {
  name  = "/staging/percy-main/BASE_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "api_base_url" {
  name  = "/staging/percy-main/API_BASE_URL"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "better_auth_rp_id" {
  name  = "/staging/percy-main/BETTER_AUTH_RP_ID"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "better_auth_rp_name" {
  name  = "/staging/percy-main/BETTER_AUTH_RP_NAME"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "play_cricket_site_id" {
  name  = "/staging/percy-main/PLAY_CRICKET_SITE_ID"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "ses_from_address" {
  name  = "/staging/percy-main/SES_FROM_ADDRESS"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# Web Push (VAPID) public key. The private half + subject live in the
# app_secrets blob. Generate a fresh keypair per environment - subscriptions
# are origin-scoped, so there's no benefit to sharing keys with production,
# and a separate staging keypair means a leaked staging private key cannot
# be used to push to production subscribers.
resource "aws_ssm_parameter" "vapid_public_key" {
  name  = "/staging/percy-main/VAPID_PUBLIC_KEY"
  type  = "String"
  value = "placeholder"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
