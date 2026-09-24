output "state_bucket" { value = aws_s3_bucket.state.id }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
output "backend_configuration" {
  value = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    key          = "serverless-temp/terraform.tfstate"
    region       = "${var.aws_region}"
    use_lockfile = true
    encrypt      = true
  EOT
}
