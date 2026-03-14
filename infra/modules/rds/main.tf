# RDS PostgreSQL Module
# Provisions a PostgreSQL instance with parameter group and subnet group.

variable "environment" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

# TODO: implement RDS resources
# - aws_db_subnet_group
# - aws_db_parameter_group (PostgreSQL 16)
# - aws_db_instance
# - aws_secretsmanager_secret (for RDS credentials)

output "endpoint" {
  value = ""
}

output "port" {
  value = 5432
}

output "database_name" {
  value = "percy_main"
}
