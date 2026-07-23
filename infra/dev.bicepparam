using './main.bicep'

param environmentName = 'dev'
param location = 'centralindia'
param frontendOrigin = 'http://localhost:3000'
// deployerObjectId and postgresAdminPassword are supplied securely by scripts/deploy-azure.ps1.
