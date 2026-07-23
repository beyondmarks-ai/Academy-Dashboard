# Academy Dashboard

Beyond Marks AI Academy's navy-and-gold Next.js dashboard with Microsoft Entra authentication and an Azure serverless backend.

## What is included

- Microsoft Entra sign-in; passwords never pass through the application
- Admission ID invitation and onboarding workflow
- PostgreSQL-backed profiles, notifications, projects, and API-access requests
- Private Azure Blob storage for uploaded `README.md` files
- Managed identities and Key Vault references instead of embedded cloud secrets
- Responsive dashboard, Markdown rendering, model-access selection, and demo skip mode

## Local frontend

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The checked-in `.env.example` points at the deployed dev API and contains public identifiers only.

## Backend

The Azure Functions backend is in `backend/` and targets Node.js 22.

```powershell
Set-Location backend
npm install
npm run typecheck
npm test
npm run build
```

Local backend settings belong in `backend/local.settings.json`; use `backend/local.settings.example.json` as the template. Neither database credentials nor Function keys are committed.

## Azure dev environment

- Resource group: `rg-bm-academy-dev`
- Region: Central India
- API: `https://bm-academy-dev-api-ydjvvkil.azurewebsites.net`
- Health: `https://bm-academy-dev-api-ydjvvkil.azurewebsites.net/api/v1/health`
- Entra client ID: `f5b76c80-0caf-4950-923c-41caa7af243b`

Infrastructure is defined in `infra/main.bicep`. It provisions Flex Consumption Functions, PostgreSQL Flexible Server, Storage, Key Vault, Application Insights, Log Analytics, and a user-assigned managed identity. PostgreSQL is a billable Burstable `Standard_B1ms` dev resource.

Validate the infrastructure:

```powershell
.\scripts\deploy-azure.ps1
```

Deploy or reconcile it:

```powershell
.\scripts\deploy-azure.ps1 -Deploy
```

Configure the Entra registration when recreating it:

```powershell
.\scripts\configure-entra.ps1 `
  -ApplicationObjectId '<application-object-id>' `
  -ClientId '<client-id>'
```

## Admission invitations

Signup requires both a valid Microsoft identity in the configured tenant and an unclaimed Admission ID. Issue an invitation without displaying the Function key:

```powershell
.\scripts\new-admission-invite.ps1 `
  -AdmissionId 'BM-2026-001' `
  -AllowedEmail 'student@example.com' `
  -ExpiresAt '2026-12-31T23:59:59Z'
```

The Admission ID is claimed atomically during onboarding. Reusing a claimed ID returns a conflict.

## API routes

Public health:

- `GET /api/v1/health`

Bearer-token protected:

- `GET /api/v1/me`
- `POST /api/v1/me/onboarding`
- `GET|POST /api/v1/projects`
- `GET /api/v1/projects/{id}`
- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/{id}/read`
- `POST /api/v1/notifications/read-all`
- `GET /api/v1/api-access`
- `POST /api/v1/api-access/requests`

Function-key protected operations are limited to migration and admission-invitation bootstrap routes.

## Verification

```powershell
npm run typecheck
npm run build
Set-Location backend
npm run typecheck
npm test
npm run build
```

Maintained by [Beyond Marks AI](https://github.com/beyondmarks-ai).
