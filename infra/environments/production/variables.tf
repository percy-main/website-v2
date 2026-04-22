variable "domain_name" {
  type    = string
  default = "percymain.org"
}

variable "alarm_email" {
  type    = string
  default = "alex.young@percymain.org"
}

variable "tailscale_db_admins" {
  type        = list(string)
  description = "Tailscale user emails (Google Workspace) allowed to reach RDS over the tailnet"
  default     = ["alex.young@percymain.org"]
}
