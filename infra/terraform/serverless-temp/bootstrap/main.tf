locals {
  name       = "tarot-temp"
  account_id = data.aws_caller_identity.current.account_id
  github_subject_repository = (
    var.github_owner_id != null && var.github_repository_id != null
    ? "${var.github_owner}@${var.github_owner_id}/${var.github_repository}@${var.github_repository_id}"
    : "${var.github_owner}/${var.github_repository}"
  )
}

resource "aws_s3_bucket" "state" {
  bucket        = "${local.name}-tfstate-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.github_oidc_thumbprint]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${local.github_subject_repository}:environment:${var.github_environment}"
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    actions = [
      "s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:ListBucketVersions",
      "s3:GetBucket*", "s3:GetAccelerateConfiguration",
      "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration",
      "s3:GetEncryptionConfiguration", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
      "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration",
      "s3:PutBucketPublicAccessBlock", "s3:PutBucketTagging"
    ]
    resources = ["arn:aws:s3:::tarot-temp-*"]
  }
  statement {
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject",
      "s3:DeleteObjectVersion"
    ]
    resources = ["arn:aws:s3:::tarot-temp-*/*"]
  }
  statement {
    actions = [
      "lambda:*"
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:tarot-temp-*"]
  }
  statement {
    actions = [
      "lambda:CreateEventSourceMapping", "lambda:GetEventSourceMapping",
      "lambda:UpdateEventSourceMapping", "lambda:DeleteEventSourceMapping"
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:event-source-mapping:*"]
  }
  statement {
    actions   = ["lambda:ListEventSourceMappings"]
    resources = ["*"]
  }
  statement {
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/tarot-temp-*"]
  }
  statement {
    actions   = ["sqs:*"]
    resources = ["arn:aws:sqs:${var.aws_region}:${local.account_id}:tarot-temp-*"]
  }
  statement {
    actions   = ["secretsmanager:*"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${local.account_id}:secret:tarot-temp/*"]
  }
  statement {
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/tarot-temp-*"]
  }
  statement {
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
  statement {
    actions   = ["events:*"]
    resources = ["arn:aws:events:${var.aws_region}:${local.account_id}:rule/tarot-temp-*"]
  }
  statement {
    actions = [
      "iam:GetRole", "iam:CreateRole", "iam:DeleteRole",
      "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies", "iam:PassRole"
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/tarot-temp-*"]
  }
  statement {
    actions   = ["iam:GetPolicy"]
    resources = ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
  }
  statement {
    actions = [
      "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource", "cloudwatch:TagResource", "cloudwatch:UntagResource"
    ]
    # CloudWatch alarm APIs do not support resource-level IAM scoping.
    resources = ["*"]
  }
  statement {
    actions   = ["cloudfront:*", "budgets:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
