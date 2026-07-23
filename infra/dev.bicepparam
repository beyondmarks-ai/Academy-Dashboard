using './main.bicep'

param environmentName = 'dev'
param location = 'centralindia'
param frontendOrigin = 'http://localhost:3000'
param entraIssuer = 'https://login.microsoftonline.com/16b09027-c852-4980-9d01-bd9ffc9b1276/v2.0'
param entraAudience = 'f5b76c80-0caf-4950-923c-41caa7af243b'
param entraJwksUri = 'https://login.microsoftonline.com/16b09027-c852-4980-9d01-bd9ffc9b1276/discovery/v2.0/keys'

// deployerObjectId and postgresAdminPassword are supplied securely by scripts/deploy-azure.ps1.
