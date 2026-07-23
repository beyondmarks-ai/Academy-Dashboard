param(
  [string]$ResourceGroup = 'rg-bm-academy-dev',
  [string]$Location = 'centralindia',
  [string]$EnvironmentName = 'dev',
  [string]$FrontendOrigin = 'http://localhost:3000',
  [switch]$Deploy
)

$ErrorActionPreference = 'Stop'

function New-SecureDatabasePassword {
  $bytes = New-Object byte[] 24
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $token = [Convert]::ToBase64String($bytes).Replace('/', 'x').Replace('+', 'Y').TrimEnd('=')
  return "Bm!9$token"
}

$account = az account show --output json | ConvertFrom-Json
if ($account.state -ne 'Enabled') { throw "Azure subscription is not enabled." }

$deployerObjectId = az ad signed-in-user show --query id --output tsv
if (-not $deployerObjectId) { throw 'Unable to resolve the signed-in Azure user object ID.' }

az provider register --namespace Microsoft.DBforPostgreSQL --wait
az provider register --namespace Microsoft.Web --wait
az provider register --namespace Microsoft.Storage --wait
az provider register --namespace Microsoft.KeyVault --wait
az provider register --namespace Microsoft.Insights --wait
az provider register --namespace Microsoft.OperationalInsights --wait

az group create --name $ResourceGroup --location $Location --tags application=academy-dashboard environment=$EnvironmentName managed-by=bicep | Out-Null

$password = New-SecureDatabasePassword
$parameters = @(
  "environmentName=$EnvironmentName",
  "location=$Location",
  "frontendOrigin=$FrontendOrigin",
  "deployerObjectId=$deployerObjectId",
  "postgresAdminPassword=$password"
)

az deployment group validate --resource-group $ResourceGroup --template-file infra/main.bicep --parameters @parameters
if ($LASTEXITCODE -ne 0) { throw 'Bicep validation failed.' }

az deployment group what-if --resource-group $ResourceGroup --template-file infra/main.bicep --parameters @parameters --result-format ResourceIdOnly
if ($LASTEXITCODE -ne 0) { throw 'Bicep what-if failed.' }

if (-not $Deploy) {
  Write-Host 'Validation and what-if completed. Re-run with -Deploy to create the resources.'
  exit 0
}

$deployment = az deployment group create --resource-group $ResourceGroup --name "academy-$EnvironmentName-$(Get-Date -Format yyyyMMddHHmmss)" --template-file infra/main.bicep --parameters @parameters --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Azure deployment failed.' }

$outputs = $deployment.properties.outputs
$connection = "postgresql://$($outputs.postgresAdminUser.value):$([Uri]::EscapeDataString($password))@$($outputs.postgresHost.value):5432/$($outputs.databaseName.value)?sslmode=verify-full"

for ($attempt = 1; $attempt -le 8; $attempt++) {
  az keyvault secret set --vault-name $outputs.keyVaultName.value --name postgres-connection --value $connection --output none 2>$null
  if ($LASTEXITCODE -eq 0) { break }
  if ($attempt -eq 8) { throw 'Unable to store the database connection in Key Vault after RBAC propagation.' }
  Start-Sleep -Seconds 15
}

Write-Host "Function app: $($outputs.functionAppName.value)"
Write-Host "API URL: $($outputs.functionAppUrl.value)"
Write-Host "Key Vault: $($outputs.keyVaultName.value)"
Write-Host 'Infrastructure deployment completed.'
