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
