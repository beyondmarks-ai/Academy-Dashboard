# Academy Dashboard

Beyond Marks AI Academy's navy-and-gold Next.js dashboard with first-party Academy ID authentication and an Azure serverless backend.

## What is included

- Private `student@beyondmarks.ai` Academy IDs that do not require email mailboxes
- Admission ID invitation, password hashing, lockout, and revocable-session workflow
- HttpOnly, same-site session cookies through a server-side Next.js proxy
- PostgreSQL-backed profiles, notifications, projects, and API-access requests
- Private Azure Blob storage for uploaded `README.md` files
- Managed identities and Key Vault references instead of embedded cloud secrets
- Responsive dashboard, Markdown rendering, model-access selection, and demo skip mode
- Dedicated administrator dashboard for student accounts, invitations, status controls, and password resets

## Local frontend

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `ACADEMY_API_BASE_URL` is server-only; the Azure API URL and session token are not exposed to browser JavaScript.

## Frontend deployment

The default production commands target standard Next.js hosting such as Hostinger:

```powershell
npm run build
npm start
```

The OpenAI Sites deployment uses the separate Cloudflare-compatible commands:

```powershell
npm run build:sites
npm run start:sites
```

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

Infrastructure is defined in `infra/main.bicep`. It provisions Flex Consumption Functions, PostgreSQL Flexible Server, Storage, Key Vault, Application Insights, Log Analytics, and a user-assigned managed identity. PostgreSQL is a billable Burstable `Standard_B1ms` dev resource.

Validate the infrastructure:

```powershell
.\scripts\deploy-azure.ps1
```

Deploy or reconcile it:

```powershell
.\scripts\deploy-azure.ps1 -Deploy
```

## Admission invitations

Signup requires an unclaimed Admission ID. Optionally bind it to exactly one Academy ID:

```powershell
.\scripts\new-admission-invite.ps1 `
  -AdmissionId 'BM-2026-001' `
  -AllowedAcademyId 'student@beyondmarks.ai' `
  -ExpiresAt '2026-12-31T23:59:59Z'
```

The Admission ID is claimed atomically during signup. The Academy ID is a login identifier, not a deliverable email address. Reusing either a claimed Admission ID or an existing Academy ID is rejected.

Create a one-time administrator invitation only from the protected CLI:

```powershell
.\scripts\new-admission-invite.ps1 `
  -AdmissionId 'BM-ADMIN' `
  -AllowedAcademyId 'admin@beyondmarks.ai' `
  -Role admin
```

The administrator uses the normal signup form once to claim this reserved invitation and choose a private password. After activation, use the dedicated **Admin sign in** button. Database constraints permit only one administrator profile and one unclaimed administrator invitation. Normal administrators can issue only student and developer invitations from the dashboard.

## Authentication security

- Passwords require at least 12 characters with uppercase, lowercase, and numeric characters.
- Passwords are stored only as uniquely salted, memory-hard `scrypt` hashes.
- Five failed passwords lock an account for 15 minutes.
- Account-, Admission-ID-, and IP-based rate limits protect authentication routes.
- Opaque 256-bit sessions expire after 12 hours, are revocable, and are stored only as SHA-256 hashes in PostgreSQL.
- The raw session stays in an HttpOnly, same-site cookie and never enters client-side storage.
- Cross-origin mutations are rejected, and the frontend emits CSP, framing, MIME-sniffing, referrer, and permissions headers.

## API routes

Public:

- `GET /api/v1/health`
- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`

Opaque-session protected:

- `GET /api/v1/me`
- `GET|POST /api/v1/projects`
- `GET /api/v1/projects/{id}`
- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/{id}/read`
- `POST /api/v1/notifications/read-all`
- `GET /api/v1/api-access`
- `POST /api/v1/api-access/requests`
- `GET /api/v1/admin/students` *(admin only)*
- `PATCH /api/v1/admin/students/{id}/status` *(admin only)*
- `POST /api/v1/admin/students/{id}/reset-password` *(admin only)*
- `GET|POST /api/v1/admin/invitations` *(admin only)*

Function-key protected operations are limited to migration, admission-invitation bootstrap, and account administration routes.

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
