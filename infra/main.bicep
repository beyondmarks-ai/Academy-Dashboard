targetScope = 'resourceGroup'

@description('Deployment environment name.')
@allowed(['dev', 'staging', 'prod'])
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Allowed browser origin for the dashboard.')
param frontendOrigin string = 'http://localhost:3000'

@description('Microsoft Entra token issuer. Leave empty until External ID is configured.')
param entraIssuer string = ''

@description('Microsoft Entra API application/client ID.')
param entraAudience string = ''

@description('Microsoft Entra JWKS endpoint.')
param entraJwksUri string = ''

@description('Object ID of the operator deploying this environment.')
param deployerObjectId string

@secure()
@description('PostgreSQL administrator password. Supplied by the deployment script and stored in Key Vault.')
param postgresAdminPassword string

@description('Deterministic suffix for globally unique names.')
@minLength(3)
param resourceToken string = take(toLower(uniqueString(subscription().id, resourceGroup().id, environmentName)), 8)

var prefix = 'bm-academy-${environmentName}'
var functionAppName = '${prefix}-api-${resourceToken}'
var storageName = take('bma${replace(environmentName, '-', '')}${resourceToken}', 24)
var keyVaultName = take('${prefix}-kv-${resourceToken}', 24)
var postgresName = take('${prefix}-pg-${resourceToken}', 63)
var deploymentContainerName = 'app-package-${resourceToken}'
var projectContainerName = 'project-files'
var postgresAdminUser = 'bmacademyadmin'

var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var keyVaultSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${resourceToken}'
  location: location
  properties: {
    retentionInDays: environmentName == 'prod' ? 90 : 30
    features: {
      searchVersion: 1
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-appi-${resourceToken}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableLocalAuth: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
  resource blobServices 'blobServices' = {
    name: 'default'
    properties: {
      deleteRetentionPolicy: {
        enabled: true
        days: 7
      }
      containerDeleteRetentionPolicy: {
        enabled: true
        days: 7
      }
    }
    resource deploymentContainer 'containers' = {
      name: deploymentContainerName
      properties: {
        publicAccess: 'None'
      }
    }
    resource projectContainer 'containers' = {
      name: projectContainerName
      properties: {
        publicAccess: 'None'
      }
    }
  }
}

resource userAssignedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-identity-${resourceToken}'
  location: location
}

resource blobOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, userAssignedIdentity.id, storageBlobDataOwnerRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, userAssignedIdentity.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource queueContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, userAssignedIdentity.id, storageQueueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, userAssignedIdentity.id, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource insightsPublisherRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, userAssignedIdentity.id, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: environmentName == 'prod' ? true : null
    enableSoftDelete: true
    softDeleteRetentionInDays: environmentName == 'prod' ? 90 : 7
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource functionSecretsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, userAssignedIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: userAssignedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerSecretsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerObjectId, keyVaultSecretsOfficerRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRoleId)
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: environmentName == 'prod' ? 14 : 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: 32
      tier: 'P4'
    }
  }
}

resource postgresAzureFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    source: 'user-override'
    value: 'pgcrypto'
  }
}

resource academyDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'academy'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${prefix}-flex-${resourceToken}'
  location: location
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    keyVaultReferenceIdentity: userAssignedIdentity.id
    siteConfig: {
      minTlsVersion: '1.2'
      http20Enabled: true
      cors: {
        allowedOrigins: [frontendOrigin]
        supportCredentials: true
      }
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: userAssignedIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: environmentName == 'prod' ? 100 : 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage__accountName: storage.name
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: userAssignedIdentity.properties.clientId
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${userAssignedIdentity.properties.clientId};Authorization=AAD'
      AZURE_CLIENT_ID: userAssignedIdentity.properties.clientId
      AZURE_STORAGE_ACCOUNT_URL: storage.properties.primaryEndpoints.blob
      PROJECT_FILES_CONTAINER: projectContainerName
      DATABASE_URL: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=postgres-connection)'
      ENTRA_ISSUER: entraIssuer
      ENTRA_AUDIENCE: entraAudience
      ENTRA_JWKS_URI: entraJwksUri
      FRONTEND_ORIGIN: frontendOrigin
      NODE_ENV: 'production'
      AUTH_DISABLED: 'false'
    }
  }
}

output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output storageAccountName string = storage.name
output keyVaultName string = keyVault.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresAdminUser string = postgresAdminUser
output databaseName string = academyDatabase.name
output managedIdentityClientId string = userAssignedIdentity.properties.clientId
