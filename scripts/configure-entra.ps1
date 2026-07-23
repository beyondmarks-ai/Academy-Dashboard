[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$ApplicationObjectId,

  [Parameter(Mandatory)]
  [string]$ClientId,

  [string]$RedirectUri = 'http://localhost:3000',

  [string]$ScopeId = '4d2abf58-a9e6-46e1-8c42-2d866a7f65e7'
)

$ErrorActionPreference = 'Stop'

$accessToken = az account get-access-token `
  --resource-type ms-graph `
  --query accessToken `
  --output tsv

if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw 'Microsoft Graph access token could not be acquired. Run az login and try again.'
}

$payload = @{
  identifierUris = @("api://$ClientId")
  spa = @{ redirectUris = @($RedirectUri) }
  web = @{ redirectUris = @() }
  optionalClaims = @{
    accessToken = @(@{ name = 'email'; essential = $false })
    idToken = @(@{ name = 'email'; essential = $false })
  }
  api = @{
    oauth2PermissionScopes = @(
      @{
        id = $ScopeId
        adminConsentDescription = 'Access the Beyond Marks Academy API as the signed-in user.'
        adminConsentDisplayName = 'Access Academy dashboard'
        isEnabled = $true
        type = 'User'
        userConsentDescription = 'Allow the dashboard to access your Beyond Marks Academy profile and workspace.'
        userConsentDisplayName = 'Access your Academy dashboard'
        value = 'access_as_user'
      }
    )
  }
} | ConvertTo-Json -Depth 8

$headers = @{
  Authorization = "Bearer $accessToken"
  'Content-Type' = 'application/json'
}

Invoke-RestMethod `
  -Method Patch `
  -Uri "https://graph.microsoft.com/v1.0/applications/$ApplicationObjectId" `
  -Headers $headers `
  -Body $payload | Out-Null

Write-Output "Configured Entra application $ClientId for $RedirectUri."
