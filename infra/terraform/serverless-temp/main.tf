locals {
  name = "tarot-${var.environment}"
  common_environment = {
    NODE_ENV          = "production"
    STORAGE_DRIVER    = "dynamodb"
    WEB_ORIGIN        = ""
    COOKIE_SECURE     = "true"
    AI_MODE           = var.ai_mode
    SPREAD_MODEL      = var.spread_model
    READING_MODEL     = var.reading_model
    APP_SECRET_ARN    = aws_secretsmanager_secret.application.arn
    READINGS_TABLE    = aws_dynamodb_table.readings.name
    CONTENT_TABLE     = aws_dynamodb_table.content.name
    RATE_LIMITS_TABLE = aws_dynamodb_table.rate_limits.name
    AGENT_QUEUE_URL   = aws_sqs_queue.agent_jobs.url
  }
}

resource "aws_s3_bucket" "web" {
  bucket_prefix = "${local.name}-web-"
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "readings" {
  name         = "${local.name}-readings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "expiryShard"
    type = "S"
  }
  attribute {
    name = "expiresAtEpoch"
    type = "N"
  }

  global_secondary_index {
    name            = "expiry-shard-index"
    hash_key        = "expiryShard"
    range_key       = "expiresAtEpoch"
    projection_type = "KEYS_ONLY"
  }

  ttl {
    attribute_name = "expiresAtEpoch"
    enabled        = true
  }
  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "content" {
  name         = "${local.name}-content"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "contentVersion"
  range_key    = "entityKey"

  attribute {
    name = "contentVersion"
    type = "S"
  }
  attribute {
    name = "entityKey"
    type = "S"
  }
  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "rate_limits" {
  name         = "${local.name}-rate-limits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "bucketKey"

  attribute {
    name = "bucketKey"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAtEpoch"
    enabled        = true
  }
  server_side_encryption {
    enabled = true
  }
}

resource "aws_sqs_queue" "agent_jobs_dlq" {
  name                      = "${local.name}-agent-jobs-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "agent_jobs" {
  name                       = "${local.name}-agent-jobs"
  visibility_timeout_seconds = 1200
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.agent_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_secretsmanager_secret" "application" {
  name                    = "${local.name}/application"
  recovery_window_in_days = 7
  description             = "TaroT OpenAI and application encryption keys; value is populated out of band."
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.readings.arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.content.arn]
  }
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.rate_limits.arn]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.agent_jobs.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application.arn]
  }
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.readings.arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.content.arn]
  }
  statement {
    actions = [
      "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes"
    ]
    resources = [aws_sqs_queue.agent_jobs.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application.arn]
  }
}

data "aws_iam_policy_document" "cleanup" {
  statement {
    actions = [
      "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem", "dynamodb:UpdateItem"
    ]
    resources = [
      aws_dynamodb_table.readings.arn, "${aws_dynamodb_table.readings.arn}/index/*"
    ]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.agent_jobs.arn]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.application.arn]
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}
resource "aws_iam_role" "worker" {
  name               = "${local.name}-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}
resource "aws_iam_role" "cleanup" {
  name               = "${local.name}-cleanup"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy_attachment" "worker_logs" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy_attachment" "cleanup_logs" {
  role       = aws_iam_role.cleanup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}
resource "aws_iam_role_policy" "worker" {
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}
resource "aws_iam_role_policy" "cleanup" {
  role   = aws_iam_role.cleanup.id
  policy = data.aws_iam_policy_document.cleanup.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = 7
}
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.name}-worker"
  retention_in_days = 7
}
resource "aws_cloudwatch_log_group" "cleanup" {
  name              = "/aws/lambda/${local.name}-cleanup"
  retention_in_days = 7
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  filename         = var.api_package_path
  source_code_hash = var.api_source_code_hash
  role             = aws_iam_role.api.arn
  handler          = "lambda.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 15
  publish          = true
  environment { variables = local.common_environment }
  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.api_logs]
}

resource "aws_lambda_function" "worker" {
  function_name    = "${local.name}-worker"
  filename         = var.worker_package_path
  source_code_hash = var.worker_source_code_hash
  role             = aws_iam_role.worker.arn
  handler          = "lambda.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  memory_size      = 1024
  timeout          = 180
  publish          = true
  environment { variables = local.common_environment }
  depends_on = [aws_cloudwatch_log_group.worker, aws_iam_role_policy_attachment.worker_logs]
}

resource "aws_lambda_function" "cleanup" {
  function_name    = "${local.name}-cleanup"
  filename         = var.cleanup_package_path
  source_code_hash = var.cleanup_source_code_hash
  role             = aws_iam_role.cleanup.arn
  handler          = "cleanup-lambda.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 60
  publish          = true
  environment { variables = local.common_environment }
  depends_on = [aws_cloudwatch_log_group.cleanup, aws_iam_role_policy_attachment.cleanup_logs]
}

resource "aws_lambda_alias" "api" {
  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
resource "aws_lambda_alias" "worker" {
  name             = "live"
  function_name    = aws_lambda_function.worker.function_name
  function_version = aws_lambda_function.worker.version
}
resource "aws_lambda_alias" "cleanup" {
  name             = "live"
  function_name    = aws_lambda_function.cleanup.function_name
  function_version = aws_lambda_function.cleanup.version
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  qualifier          = aws_lambda_alias.api.name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn        = aws_sqs_queue.agent_jobs.arn
  function_name           = aws_lambda_alias.worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2
  }
}

resource "aws_cloudwatch_event_rule" "cleanup" {
  name                = "${local.name}-cleanup"
  schedule_expression = "rate(15 minutes)"
}
resource "aws_cloudwatch_event_target" "cleanup" {
  rule = aws_cloudwatch_event_rule.cleanup.name
  arn  = aws_lambda_alias.cleanup.arn
}
resource "aws_lambda_permission" "cleanup_event" {
  statement_id  = "AllowEventBridgeCleanup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cleanup.function_name
  qualifier     = aws_lambda_alias.cleanup.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cleanup.arn
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${local.name}-lambda"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_except_host" { name = "Managed-AllViewerExceptHostHeader" }
data "aws_cloudfront_response_headers_policy" "security" { name = "Managed-SecurityHeadersPolicy" }

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${local.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite extensionless SPA routes to index.html"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }
  origin {
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
    origin_id                = "api-lambda"
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "web-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = toset(["/v1/*", "/health/*", "/docs/*"])
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "api-lambda"
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_except_host.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
      compress                   = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  qualifier              = aws_lambda_alias.api.name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.web.arn
  function_url_auth_type = "AWS_IAM"
}
resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.api.name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.web.arn
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "${local.name}-worker-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.worker.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
}
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.api.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
}
resource "aws_cloudwatch_metric_alarm" "cleanup_errors" {
  alarm_name          = "${local.name}-cleanup-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.cleanup.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
}
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${local.name}-dlq-messages"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.agent_jobs_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
}
resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${local.name}-queue-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.agent_jobs.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 600
  comparison_operator = "GreaterThanOrEqualToThreshold"
}

resource "aws_budgets_budget" "monthly" {
  count        = var.budget_notification_email == "" ? 0 : 1
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = "10"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_notification_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_notification_email]
  }
}
