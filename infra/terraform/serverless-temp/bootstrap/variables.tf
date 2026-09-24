variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}
variable "github_owner" {
  type = string
}
variable "github_repository" {
  type = string
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
