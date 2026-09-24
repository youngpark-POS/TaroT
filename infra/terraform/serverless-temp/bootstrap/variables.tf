variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}
variable "github_owner" {
  type = string
}
variable "github_owner_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Immutable GitHub owner ID. Set together with github_repository_id for repositories using immutable OIDC subjects."
}
variable "github_repository" {
  type = string
}
variable "github_repository_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Immutable GitHub repository ID. Set together with github_owner_id for repositories using immutable OIDC subjects."
}
variable "github_environment" {
  type    = string
  default = "aws-temp"
}
variable "github_oidc_thumbprint" {
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
  description = "Verify against GitHub's current OIDC certificate chain before bootstrap apply."
}
