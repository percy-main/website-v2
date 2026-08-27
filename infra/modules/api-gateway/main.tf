# API Gateway HTTP API Module (#722)
# Stands up an HTTP API in front of the ECS api service via a VPC Link and
# Cloud Map service discovery, as the eventual replacement for the ALB.
# In the stand-up phase it serves a test hostname only: api.v2 DNS, the ALB
# and the Route 53 health check are untouched. Constraints accepted with
# this path (recorded in ADR 061): hard ~30s integration timeout, buffered
# responses (no SSE/streaming), 10 MB payload cap, no WAF attach point.

# ------------------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------------------

variable "environment" {
  type        = string
  description = "Environment name"
}

variable "vpc_id" {
  type        = string
  description = "VPC to place the VPC Link in"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets for the VPC Link ENIs (same subnets the api tasks run in)"
}

variable "ecs_security_group_id" {
  type        = string
  description = "Security group of the ECS api tasks (given ingress from the VPC Link)"
}

variable "service_discovery_service_arn" {
  type        = string
  description = "Cloud Map service ARN the integration discovers api tasks through"
}

variable "zone_id" {
  type        = string
  description = "Route 53 hosted zone for the cert validation and test hostname records"
}

variable "api_domain_name" {
  type        = string
  description = "Production API hostname (cert primary name only in the stand-up phase; gets a custom domain at cutover)"
}

variable "test_domain_name" {
  type        = string
  description = "Pre-cutover verification hostname served by the gateway"
}

variable "alarms_sns_topic_arn" {
  type        = string
  description = "SNS topic ARN for the 5xx alarm"
}

variable "log_retention_days" {
  type        = number
  default     = 14
  description = "Retention for the access-log CloudWatch log group"
}

# ------------------------------------------------------------------------------
# Locals
# ------------------------------------------------------------------------------

locals {
  name_prefix = "percy-main-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = "percy-main"
    ManagedBy   = "terraform"
    Module      = "api-gateway"
  }
}

# ------------------------------------------------------------------------------
# VPC Link networking
# Mirrors the ALB -> task path: the link ENIs only ever open connections
# TO the tasks on the application port, so the link SG is egress-only and
# the task SG gets a matching ingress rule (the counterpart of
# ecs_ingress_from_alb in the vpc module - attached from here so the vpc
# module doesn't need to know about API Gateway, same pattern as
# rds_ingress_from_tailscale in environments/production).
# ------------------------------------------------------------------------------

resource "aws_security_group" "vpc_link" {
  name        = "${local.name_prefix}-vpc-link"
  description = "API Gateway VPC Link ENIs"
  vpc_id      = var.vpc_id

  tags = local.tags
}

resource "aws_security_group_rule" "vpc_link_egress_to_ecs" {
  type                     = "egress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = var.ecs_security_group_id
  security_group_id        = aws_security_group.vpc_link.id
  description              = "To ECS tasks on the application port"
}

resource "aws_security_group_rule" "ecs_ingress_from_vpc_link" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.vpc_link.id
  security_group_id        = var.ecs_security_group_id
  description              = "Inbound from API Gateway VPC Link on application port"
}

resource "aws_apigatewayv2_vpc_link" "main" {
  name               = "${local.name_prefix}-api"
  security_group_ids = [aws_security_group.vpc_link.id]
  subnet_ids         = var.subnet_ids

  tags = local.tags
}

# ------------------------------------------------------------------------------
# HTTP API
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "main" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"

  # Custom domains only - the default execute-api URL would be a second,
  # unmonitored public hostname for the same backend.
  disable_execute_api_endpoint = true

  # Deliberately no cors_configuration: CORS stays in the Fastify app
  # (@fastify/cors), exactly as behind the ALB. Configuring it here would
  # have the gateway answer preflights itself with a second, drifting
  # origin list.

  tags = local.tags
}

# HTTP_PROXY via the VPC Link straight to the Cloud Map service: the
# gateway resolves healthy task IP:port pairs with DiscoverInstances at
# request time. payload_format_version 1.0 is the only valid value for
# HTTP_PROXY - plain proxying, no Lambda-style event shaping. The
# integration timeout is the HTTP API hard maximum (30s) by default;
# deliberately not set lower.
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = var.service_discovery_service_arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.main.id
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# ------------------------------------------------------------------------------
# Access logging
# Replaces the ALB's S3 access logs on this path. 14-day retention: these
# are for cutover verification and incident triage, not archival.
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/apigateway/${local.name_prefix}-api"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

# The $default stage serves requests at the domain root, so backend paths
# pass through unmodified (no stage prefix).
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      path                    = "$context.path"
      protocol                = "$context.protocol"
      status                  = "$context.status"
      responseLength          = "$context.responseLength"
      integrationLatency      = "$context.integrationLatency"
      integrationStatus       = "$context.integrationStatus"
      integrationErrorMessage = "$context.integrationErrorMessage"
      userAgent               = "$context.identity.userAgent"
    })
  }

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Regional ACM certificate
# Covers the production hostname AND the test hostname now, so the later
# DNS flip needs no new cert - just a second custom domain + mapping.
# ------------------------------------------------------------------------------

resource "aws_acm_certificate" "api" {
  domain_name               = var.api_domain_name
  subject_alternative_names = [var.test_domain_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  # ACM issues the identical validation CNAME for the same domain in the
  # same account, so the api.v2 record here is byte-for-byte the one the
  # shared environment already manages for the ALB cert - allow_overwrite
  # makes the doubled-up management an idempotent UPSERT (same setting as
  # the shared validation records). If the shared ALB cert is ever torn
  # down first, a production apply restores the record from here.
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

# ------------------------------------------------------------------------------
# Custom domain - test hostname only in the stand-up phase.
# The cutover PR adds a second aws_apigatewayv2_domain_name + mapping for
# the production hostname and repoints its alias records here.
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_domain_name" "test" {
  domain_name = var.test_domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
    # The ALB records the flip replaces are dualstack (A + AAAA) - keep
    # IPv6 parity from the start.
    ip_address_type = "dualstack"
  }

  depends_on = [aws_acm_certificate_validation.api]

  tags = local.tags
}

resource "aws_apigatewayv2_api_mapping" "test" {
  api_id      = aws_apigatewayv2_api.main.id
  domain_name = aws_apigatewayv2_domain_name.test.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "test_a" {
  zone_id = var.zone_id
  name    = var.test_domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.test.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.test.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "test_aaaa" {
  zone_id = var.zone_id
  name    = var.test_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.test.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.test.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# ------------------------------------------------------------------------------
# Alarms
# The API GW analogue of the two ALB 5xx alarms in the monitoring module.
# HTTP API metrics don't split gateway-generated from upstream 5xx the way
# the ALB's ELB/Target metric pair does, so one alarm covers both; the
# threshold mirrors the stricter target-side alarm (>5 in 5 minutes) since
# upstream 500s are what it exists to catch.
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx_errors" {
  alarm_name          = "${local.name_prefix}-api-gateway-5xx-errors"
  alarm_description   = "API Gateway 5xx count >5 in 5min - gateway or upstream API errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.main.id
  }

  alarm_actions = [var.alarms_sns_topic_arn]
  ok_actions    = [var.alarms_sns_topic_arn]

  tags = local.tags
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------

output "api_id" {
  description = "HTTP API id (CloudWatch ApiId dimension)"
  value       = aws_apigatewayv2_api.main.id
}

output "vpc_link_id" {
  description = "VPC Link id"
  value       = aws_apigatewayv2_vpc_link.main.id
}

output "vpc_link_security_group_id" {
  description = "Security group on the VPC Link ENIs"
  value       = aws_security_group.vpc_link.id
}

output "certificate_arn" {
  description = "Regional ACM cert covering the production and test hostnames"
  value       = aws_acm_certificate.api.arn
}

output "test_url" {
  description = "Base URL of the pre-cutover verification hostname"
  value       = "https://${var.test_domain_name}"
}

output "access_log_group_name" {
  description = "CloudWatch log group receiving gateway access logs"
  value       = aws_cloudwatch_log_group.access_logs.name
}
