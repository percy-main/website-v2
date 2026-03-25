# Application secrets — stored as a single JSON object in Secrets Manager.
# Populated manually before first deploy with the following keys:
#   DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_API_KEY, STRIPE_SECRET_KEY,
#   STRIPE_WEBHOOK_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#   PLAY_CRICKET_API_TOKEN, SLACK_WEBHOOK_URL, NEW_RELIC_LICENSE_KEY

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
