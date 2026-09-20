# AWS migration skeleton

This directory is intentionally not a turnkey production deployment. It creates the durable foundations (VPC, private RDS PostgreSQL, private S3 + CloudFront OAC, ECR, ECS cluster, logs and Secrets Manager) but does not create ECS services, ALB, WAF, ACM or Route53 until a domain and immutable application image are supplied.

Before any `terraform apply`:

1. Add a remote S3 state backend with DynamoDB/S3 locking policy appropriate to the AWS account.
2. Review NAT Gateway, RDS Multi-AZ and CloudFront costs.
3. Supply an immutable ECR digest rather than a mutable tag.
4. Add API and worker task definitions in private subnets, an HTTPS ALB, least-privilege task roles, health checks and autoscaling.
5. Store OpenAI and application encryption keys in Secrets Manager; never in Terraform state.
6. Add WAF rate rules, ACM certificate and Route53 aliases.
7. Run migrations as a one-off ECS task before shifting traffic.

Validation only:

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
```
