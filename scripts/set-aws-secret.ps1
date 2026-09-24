param(
  [string]$SecretArn = "",
  [string]$Region = "ap-northeast-2"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SecretArn)) {
  $terraformDirectory = Join-Path $PSScriptRoot "..\infra\terraform\serverless-temp"
  $SecretArn = terraform -chdir=$terraformDirectory output -raw application_secret_arn
}

$secureApiKey = Read-Host "OpenAI API key" -AsSecureString
$credential = [System.Net.NetworkCredential]::new("", $secureApiKey)
$apiKey = $credential.Password
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "OpenAI API key cannot be empty."
}

function New-RandomKey {
  $bytes = [byte[]]::new(32)
  $randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $randomNumberGenerator.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
  }
  finally {
    $randomNumberGenerator.Dispose()
  }
}

$payload = @{
  OPENAI_API_KEY     = $apiKey
  DATA_ENCRYPTION_KEY = New-RandomKey
  SESSION_HMAC_KEY    = New-RandomKey
  RATE_LIMIT_HMAC_KEY = New-RandomKey
} | ConvertTo-Json -Compress

$temporaryFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($temporaryFile, $payload, [System.Text.UTF8Encoding]::new($false))
  aws secretsmanager put-secret-value `
    --region $Region `
    --secret-id $SecretArn `
    --secret-string "file://$temporaryFile" | Out-Null
  Write-Host "Application secret updated: $SecretArn"
}
finally {
  $apiKey = $null
  $payload = $null
  Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
}
