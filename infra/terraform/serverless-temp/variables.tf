variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "environment" {
  type    = string
  default = "temp"
}

variable "api_package_path" {
  type    = string
  default = "artifacts/api.zip"
}

variable "worker_package_path" {
  type    = string
  default = "artifacts/worker.zip"
}

variable "cleanup_package_path" {
  type    = string
  default = "artifacts/cleanup.zip"
}

variable "api_source_code_hash" {
  type    = string
  default = ""
}

variable "worker_source_code_hash" {
  type    = string
  default = ""
}

variable "cleanup_source_code_hash" {
  type    = string
  default = ""
}

variable "ai_mode" {
  type    = string
  default = "openai"
  validation {
    condition     = contains(["openai", "mock"], var.ai_mode)
    error_message = "ai_mode must be openai or mock."
  }
}

variable "spread_model" {
  type    = string
  default = "gpt-5.6-luna"
}

variable "reading_model" {
  type    = string
  default = "gpt-5.6-terra"
}

variable "budget_notification_email" {
  type        = string
  default     = ""
  description = "Optional email for USD 5 and USD 10 AWS budget alerts."
}
