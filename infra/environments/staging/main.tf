# Staging Environment (Phase 6)
# Same modules as production, smaller values.

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
  #   key            = "staging/terraform.tfstate"
  #   region         = "eu-west-2"
  #   dynamodb_table = "percy-main-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = "eu-west-2"
}

# module "vpc" {
#   source             = "../../modules/vpc"
#   environment        = "staging"
#   cidr_block         = "10.1.0.0/16"
#   enable_nat_gateway = true
# }

# module "rds" {
#   source             = "../../modules/rds"
#   environment        = "staging"
#   instance_class     = "db.t4g.micro"
#   allocated_storage  = 20
#   multi_az           = false
#   vpc_id             = module.vpc.vpc_id
#   private_subnet_ids = module.vpc.private_subnet_ids
#   security_group_id  = module.vpc.rds_security_group_id
# }

# module "ecs" {
#   source                = "../../modules/ecs-service"
#   environment           = "staging"
#   task_count            = 1  # Staging: 1 task (vs 2 in production)
#   cpu                   = 256
#   memory                = 512
#   vpc_id                = module.vpc.vpc_id
#   private_subnet_ids    = module.vpc.private_subnet_ids
#   public_subnet_ids     = module.vpc.public_subnet_ids
#   ecs_security_group_id = module.vpc.ecs_security_group_id
#   alb_security_group_id = module.vpc.alb_security_group_id
# }

# module "monitoring" {
#   source             = "../../modules/monitoring"
#   environment        = "staging"
#   log_retention_days = 30  # Shorter retention for staging
# }
