data "aws_caller_identity" "current" {}

resource "aws_dynamodb_table" "telemetry" {
  name         = "${local.name}-telemetry"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAtEpoch"
    enabled        = true
  }
  server_side_encryption { enabled = true }
}

resource "aws_cognito_user_pool" "monitoring" {
  name                     = "${local.name}-monitoring"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  user_pool_tier           = "LITE"
  mfa_configuration        = "OPTIONAL"
  software_token_mfa_configuration { enabled = true }
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "TaroT 운영 모니터링 관리자 초대"
      email_message = "TaroT 운영 모니터링 관리자 계정이 생성되었습니다. 계정: {username}, 임시 비밀번호: {####}. ${var.monitoring_site_origin}/monitoring 에서 로그인 후 비밀번호를 변경해 주세요."
      sms_message   = "TaroT account: {username}, temporary password: {####}"
    }
  }
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  tags = { Project = "TaroT", Environment = var.environment, Purpose = "Monitoring" }
}

resource "aws_cognito_user_pool_domain" "monitoring" {
  domain       = "${local.name}-monitor-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.monitoring.id
}

resource "aws_cognito_user_pool_client" "monitoring" {
  name                                 = "${local.name}-monitoring"
  user_pool_id                         = aws_cognito_user_pool.monitoring.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${var.monitoring_site_origin != "" ? var.monitoring_site_origin : "http://localhost:4000"}/v1/monitoring/callback"]
  logout_urls                          = ["${var.monitoring_site_origin != "" ? var.monitoring_site_origin : "http://localhost:4000"}/monitoring"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "monitoring_admins" {
  name         = "monitoring-admins"
  user_pool_id = aws_cognito_user_pool.monitoring.id
  description  = "Administrators authorized to view TaroT aggregate operational metrics."
}

data "aws_iam_policy_document" "api_monitoring" {
  statement {
    actions   = ["cloudwatch:GetMetricData", "cloudwatch:DescribeAlarms"]
    resources = ["*"]
  }
  statement {
    actions   = ["sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.agent_jobs.arn, aws_sqs_queue.agent_jobs_dlq.arn]
  }
  statement {
    actions   = ["dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.telemetry.arn]
  }
}
resource "aws_iam_role_policy" "api_monitoring" {
  name   = "monitoring-read-and-usage"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_monitoring.json
}
data "aws_iam_policy_document" "worker_telemetry" {
  statement {
    actions   = ["dynamodb:UpdateItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.telemetry.arn]
  }
}
resource "aws_iam_role_policy" "worker_telemetry" {
  name   = "usage-write"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_telemetry.json
}
