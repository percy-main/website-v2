# Application secrets — stored as a single JSON object in Secrets Manager.
# Populated manually before first deploy with the following keys:
#   DATABASE_URL, BETTER_AUTH_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PLAY_CRICKET_API_TOKEN, PLAY_CRICKET_SITE_ID,
#   SLACK_WEBHOOK_URL, SES_FROM_ADDRESS, BASE_URL, BETTER_AUTH_RP_ID, BETTER_AUTH_RP_NAME

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "production/percy-main/app"

  tags = {
    Environment = "production"
  }
}
