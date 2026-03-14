# VPC Module
# Provisions VPC, public/private subnets, NAT Gateway, and security groups.

variable "environment" {
  type        = string
  description = "Environment name (production, staging)"
}

variable "cidr_block" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "availability_zones" {
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b"]
  description = "AZs to deploy into"
}

variable "enable_nat_gateway" {
  type        = bool
  default     = true
  description = "Whether to create a NAT Gateway"
}

# TODO: implement VPC resources
# - aws_vpc
# - aws_subnet (public × AZs, private × AZs)
# - aws_internet_gateway
# - aws_nat_gateway (if enabled)
# - aws_route_table + associations
# - aws_security_group (ecs, rds, alb)
# - aws_vpc_endpoint (S3 gateway — free)

output "vpc_id" {
  value = ""
}

output "private_subnet_ids" {
  value = []
}

output "public_subnet_ids" {
  value = []
}

output "ecs_security_group_id" {
  value = ""
}

output "rds_security_group_id" {
  value = ""
}

output "alb_security_group_id" {
  value = ""
}
