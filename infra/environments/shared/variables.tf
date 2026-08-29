variable "domain_name" {
  type        = string
  default     = "percymain.org"
  description = "Primary domain name"
}

variable "github_repo" {
  type        = string
  default     = "percy-main/website-v2"
  description = "GitHub repository for OIDC trust (org/repo format)"
}

variable "ses_subdomain" {
  type        = string
  default     = "contact.percymain.org"
  description = "SES sending domain"
}

variable "alarm_email" {
  type        = string
  default     = "alex.young@percymain.org"
  description = "Email endpoint subscribed to the reliability alarms topics (both regions). Each subscription must be confirmed from the AWS confirmation email before it delivers."
}

# Transitional (#719): both variables feed the newrelic provider block,
# which must stay configured with real values until the forget has
# applied (Terraform 1.7 in CI refreshes forget-targeted resources).
# Remove in the follow-up cleanup PR.
variable "newrelic_account_id" {
  type        = number
  description = "New Relic account ID for the AWS integration link. Pass via TF_VAR_newrelic_account_id (CI sets from vars.NEW_RELIC_ACCOUNT_ID)."
}

variable "newrelic_region" {
  type        = string
  default     = "EU"
  description = "New Relic data centre region (US or EU)."
  validation {
    condition     = contains(["US", "EU"], var.newrelic_region)
    error_message = "newrelic_region must be US or EU."
  }
}
