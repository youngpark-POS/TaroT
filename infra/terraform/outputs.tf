output "cloudfront_domain" { value = aws_cloudfront_distribution.web.domain_name }
output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "database_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

