# Secrets Manager — Application Secrets
# Stores environment-specific secrets (Stripe keys, OAuth credentials, etc.)
# that are injected into ECS tasks at runtime.
#
# The secret value is managed outside Terraform (via AWS CLI or console).
# Terraform only manages the secret resource itself.

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "staging/percy-main/app"

  tags = {
    Environment = "staging"
    Project     = "percy-main"
    ManagedBy   = "terraform"
  }
}
