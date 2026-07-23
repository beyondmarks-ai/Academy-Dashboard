[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$AdmissionId,

  [string]$AllowedAcademyId = '',

  [string]$ExpiresAt = '',

  [string]$ResourceGroup = 'rg-bm-academy-dev',

  [string]$FunctionApp = 'bm-academy-dev-api-ydjvvkil'
)

$ErrorActionPreference = 'Stop'

$functionKey = az functionapp keys list `
  --resource-group $ResourceGroup `
  --name $FunctionApp `
  --query functionKeys.default `
  --output tsv

if ([string]::IsNullOrWhiteSpace($functionKey)) {
  throw 'The Function App host key could not be resolved.'
}

$payload = @{
  admissionId = $AdmissionId
  allowedAcademyId = $AllowedAcademyId
  expiresAt = $ExpiresAt
} | ConvertTo-Json

$uri = "https://$FunctionApp.azurewebsites.net/api/internal/admission-invites?code=$([Uri]::EscapeDataString($functionKey))"
$result = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $payload
$result.data | Select-Object admission_id, allowed_academy_id, expires_at, created_at
