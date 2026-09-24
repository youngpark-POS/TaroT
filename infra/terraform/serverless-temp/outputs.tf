output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_bucket" {
  value = aws_s3_bucket.web.id
}

output "content_table" {
  value = aws_dynamodb_table.content.name
}

output "application_secret_arn" {
  value = aws_secretsmanager_secret.application.arn
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}

output "worker_function_name" {
  value = aws_lambda_function.worker.function_name
}

output "cleanup_function_name" {
  value = aws_lambda_function.cleanup.function_name
}

output "agent_dlq_url" {
  value = aws_sqs_queue.agent_jobs_dlq.url
}
