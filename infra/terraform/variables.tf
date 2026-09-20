variable "aws_region" {
  type        = string
  description = "AWS region for regional resources."
  default     = "ap-northeast-2"
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "dev"
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod"
  }
}

variable "domain_name" {
  type        = string
  description = "Optional Route53/ACM domain added during the real migration."
  default     = ""
}

variable "container_image" {
  type        = string
  description = "Immutable API/worker image URI."
  default     = "public.ecr.aws/docker/library/node:24-bookworm-slim"
}

variable "database_name" {
  type    = string
  default = "tarot"
}

