# Temporary serverless deployment

This stack deploys the TaroT SPA to private S3 and the API/agent workers to Lambda in
`ap-northeast-2`. It is independent of the long-term ECS/RDS skeleton in the parent directory.

## One-time bootstrap

1. Authenticate the AWS CLI with an administrator/bootstrap role.
2. Verify the current GitHub OIDC certificate thumbprint used by `bootstrap/variables.tf`.
3. Run:

   ```powershell
   terraform -chdir=infra/terraform/serverless-temp/bootstrap init
   terraform -chdir=infra/terraform/serverless-temp/bootstrap apply `
     -var="github_owner=YOUR_OWNER" `
     -var="github_repository=YOUR_REPOSITORY"
   ```

4. Create the protected GitHub Environment `aws-temp` with required reviewers.
5. Add repository/environment variables from the bootstrap outputs:
   - `AWS_DEPLOY_ROLE_ARN`
   - `TF_STATE_BUCKET`
   - `AWS_REGION=ap-northeast-2`
   - optional `BUDGET_NOTIFICATION_EMAIL`
6. Add the output backend configuration to a local ignored `backend.hcl` if applying locally.

   ```powershell
   terraform -chdir=infra/terraform/serverless-temp init -backend-config=backend.hcl
   ```

## First deployment and secret initialization

The first deployment creates an empty Secrets Manager secret and then stops at the secret check.
Populate it without putting values in Terraform state or GitHub artifacts:

```powershell
.\scripts\set-aws-secret.ps1
```

Rerun `Deploy temporary serverless AWS`. The workflow seeds canonical content, uploads the SPA,
invalidates `index.html`, and smoke-tests the CloudFront URL. Use its `git_sha` input to deploy a
known commit as a rollback. Before every apply, the workflow records all three `live` Lambda alias
versions and downloads the currently published SPA. If a later deployment step fails, it restores
those aliases and files; S3 versioning also retains the replaced object versions.

The CloudFront distribution is compatible with the Free flat-rate plan because it uses no more
than five behaviors and only AWS-managed cache/origin policies. Attach the distribution to that
plan in the AWS CloudFront console when the account is eligible; otherwise it remains pay-as-you-go.

## OpenAI spend controls

Configure `$25` and `$50` notifications and a `$75` monthly hard limit in the OpenAI project. AWS
cannot manage that external account setting. The AWS budget is created only when
`BUDGET_NOTIFICATION_EMAIL` is set.

## Teardown

Run `Destroy temporary serverless AWS` and type `DESTROY-TAROT-TEMP`. The versioned web bucket,
DynamoDB tables, queues, functions, and logs are removed. Secrets Manager retains the application
secret for its seven-day recovery window.

After the app stack is gone, migrate the remote state back to local state, verify the local state,
and destroy `bootstrap/`. For example:

```powershell
terraform -chdir=infra/terraform/serverless-temp state pull |
  Set-Content .\tarot-temp-final.tfstate -Encoding utf8
terraform show .\tarot-temp-final.tfstate
terraform -chdir=infra/terraform/serverless-temp/bootstrap destroy `
  -var="github_owner=YOUR_OWNER" `
  -var="github_repository=YOUR_REPOSITORY"
```

Keep a protected backup of the local state until the seven-day secret recovery window has ended.
The bootstrap destroy removes the OIDC role and remote-state bucket and must be performed locally
because a workflow cannot safely delete the backend and role it is actively using.
