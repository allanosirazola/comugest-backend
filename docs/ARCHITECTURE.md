# Comugest Backend — Architecture

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Internet / CDN                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                    ┌──────────┴──────────┐
                    │  Vercel (Frontend)  │
                    │  React 18 + Vite    │
                    │  PWA / Service SW   │
                    └──────────┬──────────┘
                               │ HTTPS / JSON
                    ┌──────────┴──────────┐
                    │  Railway (Backend)  │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │  Express App  │  │
                    │  │  Port 4000    │  │
                    │  │               │  │
                    │  │  Middleware:  │  │
                    │  │  helmet       │  │
                    │  │  cors         │  │
                    │  │  rate-limit   │  │
                    │  │  authenticate │  │
                    │  └──────┬────────┘  │
                    │         │           │
                    │  ┌──────┴────────┐  │
                    │  │   Modules     │  │
                    │  │  (30+ groups) │  │
                    │  └──────┬────────┘  │
                    │         │           │
                    │  ┌──────┴────────┐  │
                    │  │ Prisma Client │  │
                    │  └──────┬────────┘  │
                    └─────────┼───────────┘
                              │ TCP
                   ┌──────────┴──────────┐
                   │  PostgreSQL 15+     │
                   │  (Railway Postgres) │
                   └─────────────────────┘

External Services:
  ┌────────────┐  ┌────────────┐  ┌──────────────┐
  │   Resend   │  │   Stripe   │  │  GoCardless  │
  │   (SMTP)   │  │ (Billing)  │  │  (Banking)   │
  └────────────┘  └────────────┘  └──────────────┘
  ┌────────────────────────────┐
  │   FCM / Web Push (VAPID)   │
  │   (Push Notifications)     │
  └────────────────────────────┘
```

---

## Module Dependency Map

```
app.ts
├── middleware/auth.middleware      (authenticate, requireRole)
├── middleware/error.middleware     (errorHandler, notFoundHandler)
├── config/env                     (validated env vars)
├── config/prisma                  (Prisma singleton)
├── config/logger                  (Winston)
│
├── modules/auth                   → email, prisma, jwt, bcrypt
├── modules/invitations            → email, prisma, auth
├── modules/communities            → prisma, audit
├── modules/units                  → prisma, audit
├── modules/invoices               → prisma, audit, email, push, notifications
├── modules/recurring-invoices     → prisma, invoices, audit
├── modules/announcements          → prisma, audit, push, notifications
├── modules/expenses               → prisma, audit
├── modules/budgets                → prisma, audit
├── modules/suppliers              → prisma, audit
├── modules/procedures             → prisma, audit, push, notifications
├── modules/tickets                → prisma, audit
├── modules/messages               → prisma, push, notifications
├── modules/meetings               → prisma, audit, push, notifications, pdfkit, qrcode
├── modules/polls                  → prisma, audit
├── modules/common-areas           → prisma, audit, push, notifications
├── modules/reservations           → prisma, audit, push, notifications
├── modules/documents              → prisma, audit
├── modules/meter-readings         → prisma, audit
├── modules/incidents              → prisma
├── modules/templates              → prisma
├── modules/reports                → prisma, pdfkit
├── modules/calendar               → prisma
├── modules/co-admins              → prisma, audit
├── modules/banking                → prisma, gocardless
├── modules/billing                → prisma, stripe, audit
├── modules/push                   → prisma, web-push
├── modules/notifications          → prisma
├── modules/import                 → prisma, csv-parse, invitations
├── modules/me                     → prisma, auth
├── modules/admin                  → prisma
├── modules/audit                  → prisma
└── modules/scheduler              → prisma, email
```

---

## Data Flow: Key Operations

### 1. Invoice Payment Recording

```
Admin clicks "Record payment"
  │
  ▼
POST /api/v1/invoices/items/:itemId/payments
  │
  ├── authenticate()         verify Bearer token
  ├── requireRole(ADMIN)     check role
  │
  ├── Zod validates body     { amount, method, paidAt, reference }
  │
  ├── prisma.payment.create()
  │     └── linked to InvoiceItem
  │
  ├── audit.log(PAYMENT_RECORDED, actor, target=Invoice)
  │
  ├── (if last unpaid item) → send push notification to owner
  │     └── push.sendToUser(ownerId, "Pago registrado")
  │
  └── 201 { payment }
```

### 2. Meeting Minutes Signing

```
Admin clicks "Sign minutes"
  │
  ▼
POST /api/v1/meetings/:id/minutes/sign
  │
  ├── authenticate()
  ├── requireRole(ADMIN_FINCAS, SUPPORT)
  │
  ├── Body: { totpCode }
  │
  ├── auth.service.verifyTotpCode(userId, totpCode)
  │     └── otplib.authenticator.check()
  │
  ├── sha256(minutes text) → signature hash
  │
  ├── prisma.meeting.update({
  │     minutesSignedAt: now,
  │     minutesSignedById: userId,
  │     minutesSignatureHash: hash
  │   })
  │
  ├── audit.log(MINUTES_SIGNED)
  │
  └── 200 { meeting }
```

### 3. CSV Import (Units + Residents)

```
Admin uploads CSV file
  │
  ▼
POST /api/v1/communities/:cId/import/csv
  │
  ├── authenticate() + requireRole(ADMIN)
  │
  ├── Parse multipart form-data
  │
  ├── csv-parse → array of rows
  │
  ├── For each row (in transaction):
  │     ├── Upsert Unit (type, label, floor, door, coefficient)
  │     ├── If ownerEmail provided:
  │     │     ├── Find or create User (status=INVITED)
  │     │     ├── Create Ownership record
  │     │     └── Send invitation email
  │     └── Record errors in result array
  │
  └── 200 { imported: N, errors: [...] }
```

### 4. Overdue Reminder (Scheduler)

```
startScheduler() — runs at startup
  │
  └── setInterval(runOverdueCheck, 6h)
        │
        ▼
  runOverdueCheck():
    │
    ├── prisma.invoiceItem.findMany({
    │     where: {
    │       invoice.dueDate: { lt: now },
    │       payments: { none: {} }
    │     }
    │   })
    │
    ├── Group overdue items by owner
    │
    ├── For each owner:
    │     └── email.send(template: overdueReminder, {
    │           firstName, count, total
    │         })
    │
    └── Errors are caught and logged (never throws)
```

---

## Database Schema Overview

### Key Models and Relationships

```
User
 ├─< RefreshToken         (1:M — active sessions)
 ├─< VerificationToken    (1:M — email/invite/reset tokens)
 ├─< CommunityAdmin       (1:M — managed communities)
 ├─< Ownership            (1:M — owned units)
 ├─< Occupancy            (1:M — occupied units)
 ├─< Invoice              (issued by)
 ├─< Payment              (registered by)
 ├─< Ticket               (reporter / assignee)
 ├─< Procedure            (requester / handler)
 ├─< Conversation         (1:1 per community)
 ├─< Reservation          (1:M)
 ├─< MeetingAttendee      (M:M with Meeting)
 ├─< PushSubscription     (1:M — devices)
 └─< Notification         (1:M)

Community
 ├─< Unit                 (1:M)
 ├─< CommunityAdmin       (M:M with User)
 ├─< Invoice              (1:M)
 ├─< Announcement         (1:M)
 ├─< Expense              (1:M)
 ├─< Budget               (1 per year)
 ├─< RecurringInvoice     (1:M)
 ├─< Meeting              (1:M)
 ├─< CommonArea           (1:M)
 ├─< Document             (1:M)
 ├─< Supplier             (1:M)
 ├─< BankAccount          (1:M)
 ├─< IncidentLog          (1:M)
 └─< MessageTemplate      (1:M)

Unit
 ├─< Ownership            (1:M — current + historical)
 ├─< Occupancy            (1:M — current + historical)
 ├─< InvoiceItem          (1:M)
 ├─< MeterReading         (1:M)
 └─< UnitNote             (1:M — private admin notes)

Invoice
 ├─< InvoiceItem          (1 per unit)
 └── RecurringInvoice?    (optional source)

InvoiceItem
 └─< Payment              (1:M — partial payments allowed)

Meeting
 ├─< MeetingAttendee      (M:M with User)
 └─< Poll                 (1:M)

Poll
 └─< Vote                 (1 per user, unique)

CommonArea
 ├─< Reservation          (1:M)
 └─< ReservationWaitlist  (1:M)

BankAccount
 └─< BankTransaction      (1:M)
```

### Enum Quick Reference

| Model | Enum field | Values |
|---|---|---|
| User | role | SUPPORT, ADMIN_FINCAS, VECINO |
| User | status | INVITED, PENDING, ACTIVE, DISABLED |
| Invoice | type | DERRAMA, INDIVIDUAL |
| Payment | method | BANK_TRANSFER, CARD, CASH, DIRECT_DEBIT, OTHER |
| Expense | category | CLEANING, LIFT, GARBAGE, GARDENING, MAINTENANCE, INSURANCE, ELECTRICITY, WATER, SECURITY, ADMIN_FEES, SUPPLIES, OTHER |
| Unit | type | VIVIENDA, LOCAL, GARAJE, TRASTERO |
| Ticket | status | OPEN, IN_PROGRESS, RESOLVED, CLOSED |
| Ticket | priority | LOW, MEDIUM, HIGH, URGENT |
| Procedure | type | CERTIFICATE, MAINTENANCE, DOCUMENT_REQUEST, COMPLAINT, PERMISSION, OTHER |
| Procedure | status | SUBMITTED, IN_REVIEW, IN_PROGRESS, COMPLETED, REJECTED |
| Meeting | type | ORDINARY, EXTRAORDINARY |
| Meeting | status | SCHEDULED, HELD, CANCELLED |
| MeetingAttendee | status | PENDING, CONFIRMED, DECLINED, DELEGATED |
| RecurringInvoice | frequency | MONTHLY, QUARTERLY, YEARLY |
| MeterReading | type | AGUA, LUZ, GAS, OTRO |
| Document | category | ACTA, REGLAMENTO, PRESUPUESTO, CONTRATO, CERTIFICADO, OTRO |
| Vote | option | FAVOR, CONTRA, ABSTENCION |
| Reservation | status | CONFIRMED, CANCELLED |

---

## Background Jobs (Scheduler)

Located in `src/modules/scheduler/scheduler.ts`.

| Job | Trigger | Action |
|---|---|---|
| Overdue reminders | On startup + every 6 hours | Finds unpaid invoice items past due date, groups by owner, sends one reminder email per owner |

The scheduler uses `setInterval` (Node.js built-in). It runs inside the same process as the web server.

Future jobs to consider: automatic recurring invoice generation (currently triggered via API endpoint), push notification batching.

---

## Email Flow

```
email.service.ts
  │
  ├── if EMAIL_PROVIDER=console → console.log (dev)
  │
  └── if EMAIL_PROVIDER=smtp:
        ├── createTransport (nodemailer / Resend SMTP)
        ├── Render HTML template from templates/ folder
        │     Templates: welcome, emailVerification, passwordReset,
        │                 invitation, overdueReminder, procedureUpdate
        ├── Variables substituted per locale (es/en)
        └── transport.sendMail()
```

---

## Push Notification Flow

```
Trigger event (e.g. new announcement, payment recorded)
  │
  ▼
notifications.service.ts
  ├── prisma.notification.create()  (in-app notification)
  └── push.service.sendToUser(userId, { title, body, url })
        │
        ├── prisma.pushSubscription.findMany({ where: { userId } })
        │
        └── For each subscription:
              └── webpush.sendNotification(subscription, payload)
                    └── VAPID-signed request → browser/FCM endpoint
```

Push notifications require the browser to have granted permission and the service worker to be registered. The VAPID public key is served from `GET /push/vapid-key` for the frontend to use.
