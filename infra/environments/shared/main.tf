# Shared / Organization-level resources
# These exist once across all environments.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # TODO: configure S3 backend after bootstrap
  # backend "s3" {
  #   bucket         = "percy-main-terraform-state"
  #   key            = "shared/terraform.tfstate"
  #   region         = "eu-west-2"
  #   dynamodb_table = "percy-main-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = "eu-west-2"
}

# TODO: implement shared resources
# - aws_route53_zone (percymain.org)
# - aws_ecr_repository (api service images)
# - aws_ses_domain_identity + verification records
# - aws_iam_role (GitHub Actions OIDC)
