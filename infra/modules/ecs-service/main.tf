# ECS Fargate Service Module
# Provisions ECS cluster, task definition, service, ALB target group, and log group.

variable "environment" {
  type = string
}

variable "task_count" {
  type    = number
  default = 2
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  type = string
}

variable "alb_security_group_id" {
  type = string
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

# TODO: implement ECS resources
# - aws_ecs_cluster
# - aws_ecs_task_definition (Fargate, ARM64)
# - aws_ecs_service
# - aws_lb (ALB)
# - aws_lb_listener
# - aws_lb_target_group (health check on /health)
# - aws_cloudwatch_log_group
# - aws_iam_role (task execution role, task role)

output "alb_dns_name" {
  value = ""
}

output "cluster_name" {
  value = ""
}

output "service_name" {
  value = ""
}
