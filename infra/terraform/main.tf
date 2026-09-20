data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_s3_bucket" "web" {
  bucket_prefix = "tarot-${var.environment}-web-"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "tarot-${var.environment}-web"
  description                       = "Private S3 access for TaroT"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "web-s3"
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

data "aws_iam_policy_document" "web" {
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
  policy = data.aws_iam_policy_document.web.json
}

resource "aws_ecs_cluster" "main" {
  name = "tarot-${var.environment}"
}

resource "aws_ecr_repository" "app" {
  name                 = "tarot-${var.environment}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/tarot-${var.environment}"
  retention_in_days = var.environment == "prod" ? 30 : 7
}

resource "aws_secretsmanager_secret" "app" {
  name = "tarot/${var.environment}/application"
}

resource "aws_db_subnet_group" "main" {
  name       = "tarot-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "database" {
  name_prefix = "tarot-${var.environment}-db-"
  vpc_id      = aws_vpc.main.id
}

resource "aws_db_instance" "postgres" {
  identifier                  = "tarot-${var.environment}"
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.environment == "prod" ? "db.t4g.small" : "db.t4g.micro"
  allocated_storage           = 20
  max_allocated_storage       = 100
  db_name                     = var.database_name
  username                    = "tarot_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  storage_encrypted           = true
  backup_retention_period     = var.environment == "prod" ? 14 : 1
  multi_az                    = var.environment == "prod"
  deletion_protection         = var.environment == "prod"
  skip_final_snapshot         = var.environment != "prod"
  publicly_accessible         = false
}

# The ALB, ECS task definitions/services, WAF, ACM and Route53 records are intentionally
# represented in the migration runbook until a real domain, certificate and immutable
# application image are supplied. This prevents an accidental costly `terraform apply`.

