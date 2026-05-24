# Comugest Backend — Technical Reference

> REST API for Comugest, a SaaS platform for homeowners-association (comunidad de vecinos) management.

---

## Table of Contents

1. [Stack Overview](#stack-overview)
2. [Project Structure](#project-structure)
3. [Environment Variables](#environment-variables)
4. [Running Locally](#running-locally)
5. [Running in Production](#running-in-production)
6. [Prisma Migrations](#prisma-migrations)
7. [Auth Flow](#auth-flow)
8. [Role System](#role-system)
9. [Error Handling](#error-handling)
10. [Audit Log System](#audit-log-system)

---

## Stack Overview

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Language | TypeScript 5 |
| ORM | Prisma 5 |
| Database | PostgreSQL 15+ |
| Auth | JWT (access + refresh) + TOTP (2FA) |
| Email | Console (dev) / SMTP via Resend (prod) |
| Push Notifications | Web Push (VAPID) |
| Payments | Stripe |
| Banking | GoCardless (optional) |
| PDF Generation | PDFKit |
| Schema Validation | Zod |
| Logging | Winston |
| Testing | Jest + Supertest |

---

## Project Structure

```
comugest-backend/
├── prisma/
│   ├── schema.prisma          # Full data model
│   ├── migrations/            # SQL migration files
│   └── seed.cjs               # Production seed (roles, initial data)
├── src/
│   ├── server.ts              # Entry point — creates app and starts HTTP
│   ├── app.ts                 # Express factory, middleware, route mounting
│   ├── config/
│   │   ├── env.ts             # Zod-validated environment variables
│   │   ├── prisma.ts          # Singleton Prisma client
│   │   └── logger.ts          # Winston logger
│   ├── middleware/
│   │   ├── auth.middleware.ts # authenticate() + requireRole()
│   │   └── error.middleware.ts# Global error + 404 handler
│   ├── utils/
│   │   ├── jwt.ts             # sign/verify access & refresh tokens
│   │   ├── errors.ts          # AppError, UnauthorizedError, ForbiddenError, …
│   │   └── asyncHandler.ts    # Wraps async route handlers
│   └── modules/
│       ├── admin/             # KPI dashboard (SUPPORT / ADMIN_FINCAS)
│       ├── announcements/     # Community board announcements
│       ├── audit/             # Immutable audit log
│       ├── auth/              # Register, login, 2FA, tokens, password reset
│       ├── banking/           # GoCardless bank accounts & transactions
│       ├── billing/           # Stripe subscription + invoice checkout
│       ├── budgets/           # Annual budget lines per community
│       ├── calendar/          # Aggregated calendar events
│       ├── co-admins/         # Assign extra admins to a community
│       ├── common-areas/      # Area management + reservation booking
│       ├── communities/       # Community CRUD
│       ├── documents/         # Document archive
│       ├── email/             # Email service (console | SMTP)
│       ├── expenses/          # Community expense ledger
│       ├── import/            # CSV bulk import of units/residents
│       ├── incidents/         # Incident log book
│       ├── invitations/       # Invite-by-email flow
│       ├── invoices/          # Billing: invoices, items, payments
│       ├── me/                # Resident self-service profile & docs
│       ├── meetings/          # Board meetings, minutes, QR check-in
│       ├── messages/          # Resident ↔ admin chat
│       ├── meter-readings/    # Water/electricity/gas meter readings
│       ├── notifications/     # In-app notifications
│       ├── polls/             # Meeting polls & votes
│       ├── procedures/        # Administrative procedures (certificates, etc.)
│       ├── push/              # Web Push subscription management
│       ├── recurring-invoices/# Recurring billing schedules
│       ├── reports/           # Financial reports (Modelo 347, etc.)
│       ├── reservations/      # Waitlist for common-area reservations
│       ├── scheduler/         # Background jobs (overdue reminders)
│       ├── suppliers/         # Supplier directory
│       ├── templates/         # Reusable message templates
│       ├── tickets/           # Internal support tickets
│       └── units/             # Units (vivienda/local/garaje/trastero) + notes
```

Each module follows the pattern:
```
<module>/
  <module>.controller.ts   # Request handlers (validation, service calls, responses)
  <module>.router.ts       # Express Router with middleware
  <module>.service.ts      # Business logic / DB queries (when extracted)
  <module>.schemas.ts      # Zod input schemas
```

---

## Environment Variables

All variables are validated at startup via Zod in `src/config/env.ts`. The server exits immediately if any required variable is missing or invalid.

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `PORT` | No | `4000` | HTTP port |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Comma-separated allowed origins |
| `FRONTEND_URL` | No | `http://localhost:5173` | Used in email links |

### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/comugest` |

### JWT / Auth

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | **Yes** | — | Min 32 chars. Signs short-lived access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | — | Min 32 chars. Signs long-lived refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL (e.g. `15m`, `1h`) |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token TTL |
| `BCRYPT_ROUNDS` | No | `12` | Bcrypt cost factor (10–15) |

### Rate Limiting

| Variable | Required | Default | Description |
|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | No | `900000` (15 min) | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window per IP |

### Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | No | `info` | `error` \| `warn` \| `info` \| `debug` |

### Email

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMAIL_PROVIDER` | No | `console` | `console` (logs to stdout) or `smtp` |
| `EMAIL_FROM` | No | `Comugest <no-reply@comugest.app>` | Sender address |
| `EMAIL_VERIFICATION_EXPIRES_HOURS` | No | `24` | How long email verification links are valid |
| `INVITATION_EXPIRES_DAYS` | No | `7` | How long invitation links are valid |

When `EMAIL_PROVIDER=smtp` additional SMTP variables are expected by the email service (host, port, user, password — check `src/modules/email/email.service.ts`).

### Stripe

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | No | `""` | Stripe secret key (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | No | `""` | Webhook endpoint signing secret (`whsec_…`) |
| `STRIPE_PRICE_ID` | No | `""` | Default subscription price ID |

### Web Push (VAPID)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` | No | `""` | Base64 VAPID public key |
| `VAPID_PRIVATE_KEY` | No | `""` | Base64 VAPID private key |
| `VAPID_EMAIL` | No | `mailto:admin@comugest.app` | Contact email included in VAPID header |

---

## Running Locally

### Prerequisites

- Node.js ≥ 20
- PostgreSQL 15+ running locally (or a cloud instance)
- `npm` or `pnpm`

### Steps

```bash
# 1. Install dependencies
cd comugest-backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run database migrations
npm run prisma:migrate
# or for an existing DB without migration tracking:
# npx prisma db push

# 5. (Optional) Seed initial data
npm run prisma:seed

# 6. Start dev server with hot-reload
npm run dev
# Server starts at http://localhost:4000
# Health check: GET http://localhost:4000/health
```

### Useful dev commands

```bash
npm run prisma:studio    # Prisma Studio GUI at http://localhost:5555
npm run test             # Run Jest test suite
npm run lint             # ESLint
npm run format           # Prettier
```

---

## Running in Production

### Build

```bash
npm run build
# Compiles TypeScript → dist/
```

### Start

```bash
NODE_ENV=production node dist/server.js
```

Or use the combined start script which runs migrations and seed first:

```bash
npm run start:prod
# Equivalent to: prisma migrate deploy && seed && node dist/server.js
```

### Railway (recommended)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full step-by-step Railway deployment guide.

---

## Prisma Migrations

### Development workflow

```bash
# Create and apply a new migration
npx prisma migrate dev --name describe_your_change

# Reset DB and re-run all migrations (destroys data)
npx prisma migrate reset

# Inspect current migration status
npx prisma migrate status
```

### Production deployment

```bash
# Applies all pending migrations without prompting
npx prisma migrate deploy
```

This command is idempotent — safe to run on every deploy.

### Generating the Prisma client

Run after any schema change:
```bash
npm run prisma:generate
# or
npx prisma generate
```

---

## Auth Flow

### Registration

```
POST /api/v1/auth/register
  → Creates User (status=PENDING)
  → Sends verification email with signed VerificationToken
POST /api/v1/auth/verify-email  { token }
  → Sets emailVerifiedAt, status=ACTIVE
```

### Login

```
POST /api/v1/auth/login  { email, password }
  → Verifies password (bcrypt)
  → If totpEnabled: returns { requiresTwoFactor: true, preAuthToken }
  → Otherwise: returns { accessToken, refreshToken, user }

POST /api/v1/auth/login/2fa  { preAuthToken, totpCode }
  → Verifies TOTP code (otplib)
  → Returns { accessToken, refreshToken, user }
```

### Token lifecycle

- **Access token**: JWT, signed with `JWT_ACCESS_SECRET`, expires in `JWT_ACCESS_EXPIRES_IN` (default 15 min). Contains `{ sub: userId, role }`.
- **Refresh token**: JWT, signed with `JWT_REFRESH_SECRET`, expires in `JWT_REFRESH_EXPIRES_IN` (default 30 days). Stored as a hashed record in `RefreshToken` table.

```
POST /api/v1/auth/refresh  { refreshToken }
  → Validates token, issues new access+refresh pair (rotation)

POST /api/v1/auth/logout  { refreshToken }
  → Revokes the refresh token record
```

### Password reset

```
POST /api/v1/auth/forgot-password  { email }
  → Creates VerificationToken (type=PASSWORD_RESET), sends email

POST /api/v1/auth/reset-password  { token, newPassword }
  → Marks token used, updates passwordHash
```

### Two-Factor Authentication (TOTP)

```
POST /api/v1/me/profile/2fa/setup
  → Generates TOTP secret, returns QR code URI

POST /api/v1/me/profile/2fa/verify  { token }
  → Confirms TOTP code, enables 2FA on the account

POST /api/v1/me/profile/2fa/disable  { token }
  → Verifies current code, disables 2FA
```

TOTP is implemented with `otplib`. The secret is stored encrypted in `User.totpSecret`.

---

## Role System

| Role | Description | Typical user |
|---|---|---|
| `ADMIN_FINCAS` | Property manager. Full access to all communities they manage. Can create communities, issue invoices, manage residents. | External property management company |
| `SUPPORT` | Comugest platform operator. Super-admin — can access all communities and all admin-level endpoints. | Internal Comugest staff |
| `VECINO` | Resident/owner. Can only see data for their own communities and their own records. | Flat owner or tenant |

### Enforcement

Roles are embedded in the JWT access token payload. The `requireRole(...roles)` middleware in `src/middleware/auth.middleware.ts` enforces access at the route level.

Community-level scoping (ensuring an `ADMIN_FINCAS` can only manage their own communities) is enforced in controller logic via `CommunityAdmin` join table lookups.

---

## Error Handling

All errors flow through the global handler in `src/middleware/error.middleware.ts`.

### Response envelope

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### Error codes

| HTTP | Code | Trigger |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod schema failure — `details` contains field errors |
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 403 | `FORBIDDEN` | Authenticated but insufficient role |
| 404 | `NOT_FOUND` | Resource not found (Prisma P2025) or unknown route |
| 409 | `CONFLICT` | Unique constraint violation (Prisma P2002) |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unhandled exception (details not exposed to client) |

### Custom error classes (`src/utils/errors.ts`)

```typescript
class AppError extends Error         // base
class UnauthorizedError extends AppError   // 401
class ForbiddenError extends AppError      // 403
class NotFoundError extends AppError       // 404
class ConflictError extends AppError       // 409
class BadRequestError extends AppError     // 400
```

---

## Audit Log System

Every significant mutation records an `AuditLog` entry automatically.

### Model

```
AuditLog {
  action      AuditAction   // enum — what happened
  actorId     String?       // who did it (null = system)
  targetType  String?       // "Invoice", "Community", etc.
  targetId    String?       // ID of the affected record
  communityId String?       // for per-community filtering
  meta        Json?         // extra context (amounts, names, before/after)
  createdAt   DateTime
}
```

### Tracked actions

`INVOICE_CREATED`, `INVOICE_CANCELLED`, `PAYMENT_RECORDED`, `PAYMENT_DELETED`, `RESIDENT_INVITED`, `RESIDENT_ACTIVATED`, `COMMUNITY_CREATED`, `COMMUNITY_DELETED`, `ANNOUNCEMENT_PUBLISHED`, `EXPENSE_CREATED`, `EXPENSE_DELETED`, `PROCEDURE_SUBMITTED`, `PROCEDURE_STATUS_CHANGED`, `TICKET_CREATED`, `TICKET_STATUS_CHANGED`, `BUDGET_UPSERTED`, `USER_LOGIN`, `USER_ROLE_CHANGED`, `RESERVATION_CREATED`, `RESERVATION_CANCELLED`, `MEETING_CREATED`, `MEETING_UPDATED`, `MEETING_CANCELLED`, `RECURRING_INVOICE_CREATED`, `RECURRING_INVOICE_TRIGGERED`, `DOCUMENT_CREATED`, `DOCUMENT_DELETED`, `SUPPLIER_CREATED`, `SUPPLIER_UPDATED`, `SUPPLIER_DELETED`, `POLL_CREATED`, `POLL_CLOSED`, `VOTE_CAST`, `CO_ADMIN_ADDED`, `CO_ADMIN_REMOVED`, `METER_READING_ADDED`, `MINUTES_SAVED`, `MINUTES_PUBLISHED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_CANCELLED`

### Querying

```
GET /api/v1/admin/audit?communityId=&action=&page=&limit=
```

Access restricted to `ADMIN_FINCAS` and `SUPPORT`.
