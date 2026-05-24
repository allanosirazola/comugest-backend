# Comugest Backend — Deployment Guide

This guide covers deploying the backend on **Railway**, the recommended platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Railway Deployment — Step by Step](#railway-deployment--step-by-step)
3. [Database Provisioning](#database-provisioning)
4. [Environment Variables Checklist](#environment-variables-checklist)
5. [Prisma Migrate on Deploy](#prisma-migrate-on-deploy)
6. [Health Check Endpoint](#health-check-endpoint)
7. [SMTP Setup (Resend)](#smtp-setup-resend)
8. [Stripe Setup](#stripe-setup)
9. [VAPID Keys (Web Push)](#vapid-keys-web-push)
10. [GoCardless (Optional Banking)](#gocardless-optional-banking)
11. [Monitoring Recommendations](#monitoring-recommendations)

---

## Prerequisites

- Railway account at [railway.app](https://railway.app)
- GitHub repository with the backend code
- A domain (or Railway-generated subdomain)
- Node.js 20 (enforced via `engines` in `package.json`)

---

## Railway Deployment — Step by Step

### 1. Create a Railway project

```
1. Log in at railway.app
2. Click "New Project"
3. Choose "Deploy from GitHub repo"
4. Select the comugest-backend repository
5. Railway detects Node.js automatically
```

### 2. Configure build and start commands

Railway reads `package.json` scripts. Set in the Railway service settings:

| Setting | Value |
|---|---|
| Build Command | `npm run build` |
| Start Command | `npm run start:prod` |

`npm run start:prod` runs migrations and seeds before starting the server:
```
prisma migrate deploy && node prisma/seed.cjs && node dist/server.js
```

### 3. Add environment variables

In Railway → your service → "Variables" tab, add all variables from the [checklist below](#environment-variables-checklist).

### 4. Add PostgreSQL

See [Database Provisioning](#database-provisioning).

### 5. Deploy

Push to your default branch or click "Deploy" in the Railway UI. Railway will:
1. Install npm dependencies
2. Run `npm run build` (TypeScript → `dist/`)
3. Run `npm run start:prod` (migrate + seed + serve)

### 6. Configure custom domain (optional)

In Railway → service → "Settings" → "Domains", add a custom domain and configure your DNS CNAME to point to the Railway-provided hostname.

---

## Database Provisioning

### PostgreSQL on Railway

```
1. In your Railway project, click "+ New"
2. Choose "Database" → "PostgreSQL"
3. Railway creates a Postgres instance and exposes:
   - DATABASE_URL (connection string)
   - PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
```

Railway automatically injects `DATABASE_URL` into your service environment if you connect them via "Reference Variable":

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

### Backups

Railway does not provide automatic backups on the free tier. For production:
- Use Railway's paid plan which includes daily backups, OR
- Set up a cron job using `pg_dump` to an S3-compatible bucket

---

## Environment Variables Checklist

Copy this checklist to your Railway Variables tab. Variables marked **required** will cause a startup failure if missing.

### Core

```env
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://your-frontend.vercel.app
FRONTEND_URL=https://your-frontend.vercel.app
```

### Database

```env
# Reference from Railway Postgres addon:
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

### JWT Secrets — generate with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

```env
JWT_ACCESS_SECRET=<64-char-hex>          # REQUIRED, min 32 chars
JWT_REFRESH_SECRET=<64-char-hex>         # REQUIRED, min 32 chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12
```

### Rate Limiting

```env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
```

### Logging

```env
LOG_LEVEL=info
```

### Email (Resend SMTP)

```env
EMAIL_PROVIDER=smtp
EMAIL_FROM=Comugest <no-reply@comugest.app>
EMAIL_VERIFICATION_EXPIRES_HOURS=24
INVITATION_EXPIRES_DAYS=7
# Additional SMTP vars (check email.service.ts for exact names):
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_<your-resend-api-key>
```

### Stripe

```env
STRIPE_SECRET_KEY=sk_live_<key>
STRIPE_WEBHOOK_SECRET=whsec_<key>
STRIPE_PRICE_ID=price_<id>
```

### Web Push (VAPID)

```env
VAPID_PUBLIC_KEY=<base64-public-key>
VAPID_PRIVATE_KEY=<base64-private-key>
VAPID_EMAIL=mailto:admin@comugest.app
```

---

## Prisma Migrate on Deploy

The start command `npm run start:prod` automatically runs:

```bash
npx prisma migrate deploy
```

This applies all pending migrations. It is **idempotent** — safe to run on every deploy.

### Manual migration (if needed)

```bash
# SSH into the Railway container (requires Railway CLI):
railway run npx prisma migrate deploy

# Or locally against the production DB:
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### Checking migration status

```bash
railway run npx prisma migrate status
```

---

## Health Check Endpoint

The API exposes:

```
GET /health
→ 200 { "status": "ok", "timestamp": "2024-01-15T12:00:00.000Z" }
```

Configure Railway health checks:
- Path: `/health`
- Method: `GET`
- Expected status: `200`

---

## SMTP Setup (Resend)

[Resend](https://resend.com) is the recommended email provider.

### Steps

1. Create an account at resend.com
2. Add and verify your domain
3. Create an API key
4. Use Resend SMTP:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (TLS)
   - Username: `resend`
   - Password: your Resend API key

5. Set environment variables:
   ```env
   EMAIL_PROVIDER=smtp
   EMAIL_FROM=Comugest <no-reply@yourdomain.com>
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASSWORD=re_xxxx
   ```

---

## Stripe Setup

### Steps

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Create a product + recurring price (the subscription plan)
3. Copy the Price ID (`price_…`)
4. Enable webhooks:
   - Endpoint URL: `https://your-api-domain/api/v1/billing/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
5. Copy the webhook signing secret (`whsec_…`)

### Environment variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

### Testing locally

```bash
stripe listen --forward-to localhost:4000/api/v1/billing/webhook
```

---

## VAPID Keys (Web Push)

VAPID keys identify your server for Web Push notifications.

### Generate keys

```bash
# Using web-push CLI:
npx web-push generate-vapid-keys

# Output:
# Public Key: BN...
# Private Key: k...
```

### Environment variables

```env
VAPID_PUBLIC_KEY=BNcRdreALRFXTkOOUHK1xAlkemqkMEXBvjXwSp7JQ...
VAPID_PRIVATE_KEY=k7o3v...
VAPID_EMAIL=mailto:admin@comugest.app
```

The public key is served to the frontend at `GET /push/vapid-key` and used to subscribe the service worker.

---

## GoCardless (Optional Banking)

GoCardless provides Open Banking access to read bank transactions.

### Setup

1. Create an account at [bankaccountdata.gocardless.com](https://bankaccountdata.gocardless.com)
2. Obtain your `SECRET_ID` and `SECRET_KEY`
3. Add to environment variables (check `src/modules/banking/banking.controller.ts` for exact variable names)

GoCardless is optional — the banking module degrades gracefully if credentials are not provided.

---

## Monitoring Recommendations

### Logging

Winston logs to stdout with level configured by `LOG_LEVEL`. Railway captures all stdout/stderr.

Access logs in Railway → your service → "Logs" tab.

### Alerts

Configure Railway alerts for:
- Service crashes (restart count)
- Memory usage > 90%
- CPU spikes

### Uptime monitoring

Use a free service like [BetterUptime](https://betteruptime.com) or [UptimeRobot](https://uptimerobot.com) to monitor the `/health` endpoint every 5 minutes.

### Database

Monitor PostgreSQL metrics via Railway's built-in database dashboard:
- Active connections
- Database size
- Slow queries (enable `pg_stat_statements` extension)

### Error tracking (optional)

Integrate Sentry for production error tracking:

```typescript
// src/app.ts
import * as Sentry from '@sentry/node';
Sentry.init({ dsn: process.env.SENTRY_DSN });
```

Add `SENTRY_DSN` to environment variables.
