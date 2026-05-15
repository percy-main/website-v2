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
# entries (psql over Tailscale — see docs/adrs/044-db-role-split.md).
# When true:
#   - API DATABASE_URL → app_rw secret
#   - Migration DATABASE_URL → app_ddl secret
#   - Master credentials secret IAM-restricted to break-glass principals
variable "app_rw_active" {
  type        = bool
  default     = false
  description = "Cutover flag for the app_rw / app_ddl DB role split. Flip to true only after operator-bootstrap of role passwords (see ADR 044)."
}

# Principals allowed to read the master DB credentials secret once
# app_rw_active = true. Defaults to empty — must be populated before
# flipping the cutover flag, otherwise even break-glass recovery is
# impossible (the resource policy denies everyone except this list).
# Typical entries: a named IAM user/role for the on-call admin.
variable "master_db_break_glass_principal_arns" {
  type        = list(string)
  default     = []
  description = "ARNs allowed to read the master DB credentials secret in break-glass scenarios once app_rw_active = true."
}
