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

# Cutover flag for the app_rw / app_ddl role split (#130). Stays false
# while the new roles exist NOLOGIN; operators flip to true once they
# have set the roles' LOGIN passwords from the new Secrets Manager
# entries (psql over Tailscale - see docs/adrs/044-db-role-split.md).
# When true:
#   - API DATABASE_URL → app_rw secret
#   - Migration DATABASE_URL → app_ddl secret
#   - Master credentials secret IAM-restricted to break-glass principals
variable "app_rw_active" {
  type        = bool
  default     = false
  description = "Cutover flag for the app_rw / app_ddl DB role split. Flip to true only after operator-bootstrap of role passwords (see ADR 043)."
}

# Extra principals exempted from the master credentials secret's
# break-glass deny policy. Defaults to empty - the primary access
# path is the audited `percy-main-db-break-glass` IAM role created in
# the shared layer (always included automatically). Use this only
# for one-off escape hatches (auditor access, vendor incident
# response) and remove again afterwards.
variable "master_db_break_glass_principal_arns" {
  type        = list(string)
  default     = []
  description = "Extra ARNs exempted from the master DB credentials secret's deny policy (in addition to the dedicated break-glass role + Terraform roles). Leave empty unless temporarily granting an auditor / vendor access."
}
