terraform {
  required_version = ">= 1.14"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.22" }
  }
  backend "s3" {
    region       = "us-east-1"
    key          = "projects/vellum-and-vector.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { Project = "vellum-and-vector", ManagedBy = "Terraform" }
  }
}

locals {
  prefix = "vellum-and-vector"
  app    = "vellum-and-vector.ahara.io"
}

module "frontend" {
  source         = "git::https://github.com/chris-arsenault/ahara-tf-patterns.git//modules/website?ref=34287b1925e1b5681281c1fb3ee9199211202ec9"
  prefix         = local.prefix
  hostname       = local.app
  site_directory = "${path.module}/../../frontend/dist"
  encrypt        = false
}

output "app_url" { value = "https://${local.app}" }
output "bucket_name" { value = module.frontend.bucket_name }
output "distribution_id" { value = module.frontend.distribution_id }
