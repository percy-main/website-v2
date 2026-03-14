# Monitoring Module
# Provisions CloudWatch dashboards, alarms, and log groups.

variable "environment" {
  type = string
}

variable "alarm_email" {
  type    = string
  default = ""
}

variable "log_retention_days" {
  type    = number
  default = 180
}

# TODO: implement monitoring resources
# - aws_sns_topic (alarm notifications)
# - aws_cloudwatch_metric_alarm (error rates, health check failures)
# - aws_cloudwatch_dashboard
# - aws_cloudwatch_log_group (ECS, data pipelines)

output "sns_topic_arn" {
  value = ""
}
