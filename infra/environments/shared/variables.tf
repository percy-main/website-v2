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
