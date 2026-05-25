# Comugest API Reference

Base URL: `https://<host>/api/v1`

All authenticated endpoints require:
```
Authorization: Bearer <accessToken>
```

Success responses return HTTP 2xx with a JSON body.  
Error responses follow the envelope: `{ "error": { "code", "message", "details" } }`.

---

## Table of Contents

- [Health](#health)
- [Auth](#auth)
- [Invitations](#invitations)
- [Me (self-service)](#me-self-service)
- [Communities](#communities)
- [Units](#units)
- [Invoices](#invoices)
- [Recurring Invoices](#recurring-invoices)
- [Announcements](#announcements)
- [Expenses](#expenses)
- [Budgets](#budgets)
- [Suppliers](#suppliers)
- [Procedures](#procedures)
- [Tickets](#tickets)
- [Messages](#messages)
- [Meetings](#meetings)
- [Polls](#polls)
- [Common Areas & Reservations](#common-areas--reservations)
- [Waitlist](#waitlist)
- [Documents](#documents)
- [Meter Readings](#meter-readings)
- [Incidents](#incidents)
- [Templates](#templates)
- [Reports](#reports)
- [Calendar](#calendar)
- [Co-Admins](#co-admins)
- [Banking](#banking)
- [Notifications](#notifications)
- [Push Subscriptions](#push-subscriptions)
- [Billing (Stripe)](#billing-stripe)
- [Import (CSV)](#import-csv)
- [Admin](#admin)
- [Audit Log](#audit-log)

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Returns `{ status: "ok", timestamp }` |

---

## Auth

Rate-limited to 20 requests / 15 min (auth endpoints) or 5 requests / 1 hour (verification emails).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Create account |
| POST | `/auth/login` | None | Login, returns tokens or 2FA challenge |
| POST | `/auth/login/2fa` | None | Complete 2FA login |
| POST | `/auth/verify-email` | None | Verify email address |
| POST | `/auth/resend-verification` | None | Resend verification email |
| POST | `/auth/forgot-password` | None | Send password reset email |
| POST | `/auth/reset-password` | None | Set new password using reset token |
| POST | `/auth/refresh` | None | Rotate access + refresh tokens |
| POST | `/auth/logout` | None | Revoke refresh token |
| GET  | `/auth/me` | Bearer | Get authenticated user info |

### POST /auth/register

**Request body**
```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "firstName": "María",
  "lastName": "García",
  "phone": "+34600000000"    // optional
}
```

**Response 201**
```json
{
  "requiresEmailVerification": true,
  "email": "user@example.com"
}
```

### POST /auth/login

**Request body**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Response 200 — no 2FA**
```json
{
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…",
  "user": { "id", "email", "firstName", "lastName", "role", "status" }
}
```

**Response 200 — 2FA enabled**
```json
{ "requiresTwoFactor": true, "preAuthToken": "eyJ…" }
```

### POST /auth/login/2fa

**Request body**
```json
{ "preAuthToken": "eyJ…", "totpCode": "123456" }
```

**Response 200**: same as full login response above.

### POST /auth/verify-email

```json
{ "token": "<verification-token-from-email>" }
```

### POST /auth/forgot-password

```json
{ "email": "user@example.com" }
```

Always returns 200 (no enumeration).

### POST /auth/reset-password

```json
{ "token": "<reset-token>", "newPassword": "newSecret123" }
```

### POST /auth/refresh

```json
{ "refreshToken": "eyJ…" }
```

**Response 200**
```json
{ "accessToken": "eyJ…", "refreshToken": "eyJ…" }
```

---

## Invitations

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/invitations` | Bearer | ADMIN_FINCAS, SUPPORT | Invite a new resident by email |
| POST | `/invitations/accept` | None | — | Accept invitation and set password |

### POST /invitations

```json
{
  "email": "vecino@example.com",
  "firstName": "Juan",
  "lastName": "Pérez",
  "communityId": "cld…",
  "unitId": "cld…",         // optional
  "role": "VECINO"           // optional, defaults to VECINO
}
```

### POST /invitations/accept

```json
{
  "token": "<invitation-token>",
  "password": "newpassword123"
}
```

---

## Me (self-service)

All `/me` routes require Bearer token (any role).

| Method | Path | Description |
|---|---|---|
| GET | `/me/profile` | Get own profile |
| PATCH | `/me/profile` | Update own profile |
| POST | `/me/profile/change-password` | Change password |
| POST | `/me/profile/2fa/setup` | Begin TOTP setup |
| POST | `/me/profile/2fa/verify` | Confirm TOTP setup |
| POST | `/me/profile/2fa/disable` | Disable TOTP |
| GET | `/me/communities` | Communities I belong to |
| GET | `/me/invoice-items` | My invoice items (bills) |
| GET | `/me/announcements` | Announcements for my communities |
| GET | `/me/expenses` | Expenses from my communities |
| GET | `/me/tickets` | My support tickets |
| GET | `/me/procedures` | My admin procedures |
| GET | `/me/reservations` | My area reservations |
| GET | `/me/meetings` | Meetings I'm invited to |
| GET | `/me/documents` | Community documents visible to me |
| GET | `/me/calendar` | My upcoming events |
| GET | `/me/notifications` | My in-app notifications |
| PATCH | `/me/notifications/:id/read` | Mark notification as read |
| POST | `/me/notifications/mark-all-read` | Mark all as read |
| GET | `/me/waitlist` | My waitlist entries |

### PATCH /me/profile

```json
{
  "firstName": "María",
  "lastName": "García López",
  "phone": "+34600000001",
  "locale": "en"
}
```

### POST /me/profile/change-password

```json
{ "currentPassword": "old", "newPassword": "new" }
```

### POST /me/profile/2fa/setup

**Response**
```json
{
  "secret": "BASE32SECRET",
  "otpAuthUrl": "otpauth://totp/Comugest:user@example.com?secret=…"
}
```

---

## Communities

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/communities` | Bearer | ADMIN_FINCAS, SUPPORT | Create community |
| GET | `/communities` | Bearer | ADMIN_FINCAS, SUPPORT | List all managed communities |
| GET | `/communities/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Get community detail |
| PATCH | `/communities/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update community |
| DELETE | `/communities/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete community |

### POST /communities — request body

```json
{
  "name": "Comunidad Las Flores",
  "address": "Calle Mayor 1",
  "city": "Madrid",
  "postalCode": "28001",
  "country": "ES",
  "cif": "H12345678"
}
```

### Response shape (GET /communities/:id)

```json
{
  "id": "cld…",
  "name": "Comunidad Las Flores",
  "address": "Calle Mayor 1",
  "city": "Madrid",
  "postalCode": "28001",
  "country": "ES",
  "cif": "H12345678",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "_count": { "units": 12, "admins": 2 }
}
```

---

## Units

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/units` | Bearer | ADMIN_FINCAS, SUPPORT | List units in a community |
| POST | `/communities/:cId/units` | Bearer | ADMIN_FINCAS, SUPPORT | Create a unit |
| PATCH | `/units/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update a unit |
| DELETE | `/units/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete a unit |
| GET | `/communities/:cId/units/:unitId/delinquency` | Bearer | ADMIN_FINCAS, SUPPORT | Delinquency history for unit |
| GET | `/communities/:cId/units/:unitId/ownership-history` | Bearer | ADMIN_FINCAS, SUPPORT | Ownership history |
| GET | `/units/:unitId/notes` | Bearer | ADMIN_FINCAS, SUPPORT | List private notes on unit |
| POST | `/units/:unitId/notes` | Bearer | ADMIN_FINCAS, SUPPORT | Add note to unit |
| DELETE | `/units/:unitId/notes/:noteId` | Bearer | ADMIN_FINCAS, SUPPORT | Delete note |

### POST /communities/:cId/units — request body

```json
{
  "type": "VIVIENDA",
  "label": "1A",
  "floor": "1",
  "door": "A",
  "coefficient": 0.08500,
  "surfaceM2": 75.50
}
```

`type` must be one of: `VIVIENDA`, `LOCAL`, `GARAJE`, `TRASTERO`

---

## Invoices

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/invoices` | Bearer | ADMIN_FINCAS, SUPPORT | List invoices for community |
| POST | `/communities/:cId/invoices` | Bearer | ADMIN_FINCAS, SUPPORT | Create invoice |
| POST | `/communities/:cId/invoices/bulk` | Bearer | ADMIN_FINCAS, SUPPORT | Bulk create invoices |
| GET | `/communities/:cId/invoices/overdue` | Bearer | ADMIN_FINCAS, SUPPORT | List overdue invoice items |
| POST | `/communities/:cId/invoices/:invoiceId/sepa` | Bearer | ADMIN_FINCAS, SUPPORT | Export SEPA XML |
| GET | `/communities/:cId/invoices/:invoiceId/pdf` | Bearer | ADMIN_FINCAS, SUPPORT | Download invoice PDF |
| GET | `/invoices/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Get invoice detail |
| DELETE | `/invoices/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Cancel invoice |
| POST | `/invoices/items/:itemId/payments` | Bearer | ADMIN_FINCAS, SUPPORT | Record payment on an item |
| DELETE | `/invoices/payments/:paymentId` | Bearer | ADMIN_FINCAS, SUPPORT | Delete payment |
| GET | `/me/invoice-items` | Bearer | Any | Resident's own invoice items |

### POST /communities/:cId/invoices — DERRAMA (shared levy)

```json
{
  "type": "DERRAMA",
  "concept": "Derrama ascensor",
  "description": "Reparación urgente",
  "totalAmount": 5000.00,
  "dueDate": "2024-03-31"
}
```
Items are automatically created for each unit proportionally by `coefficient`.

### POST /communities/:cId/invoices — INDIVIDUAL (per-unit amounts)

```json
{
  "type": "INDIVIDUAL",
  "concept": "Agua Q1 2024",
  "dueDate": "2024-03-31",
  "items": [
    { "unitId": "cld…", "amount": 42.30, "consumptionValue": 6.5, "consumptionUnit": "m3" }
  ]
}
```

### POST /invoices/items/:itemId/payments

```json
{
  "amount": 42.30,
  "paidAt": "2024-02-15T10:00:00Z",
  "method": "BANK_TRANSFER",
  "reference": "TRANSF-001",
  "notes": "optional note"
}
```

`method`: `BANK_TRANSFER` | `CARD` | `CASH` | `DIRECT_DEBIT` | `OTHER`

---

## Recurring Invoices

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/recurring` | Bearer | ADMIN_FINCAS, SUPPORT | List recurring schedules |
| POST | `/communities/:cId/recurring` | Bearer | ADMIN_FINCAS, SUPPORT | Create schedule |
| PATCH | `/communities/:cId/recurring/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update schedule |
| DELETE | `/communities/:cId/recurring/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete schedule |
| POST | `/communities/:cId/recurring/:id/trigger` | Bearer | ADMIN_FINCAS, SUPPORT | Manually trigger generation |

### POST /communities/:cId/recurring

```json
{
  "concept": "Cuota ordinaria",
  "frequency": "MONTHLY",
  "amount": 120.00,
  "dayOfMonth": 1,
  "nextBillingAt": "2024-02-01"
}
```

`frequency`: `MONTHLY` | `QUARTERLY` | `YEARLY`

---

## Announcements

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/announcements` | Bearer | ADMIN_FINCAS, SUPPORT | List community announcements |
| POST | `/communities/:cId/announcements` | Bearer | ADMIN_FINCAS, SUPPORT | Create announcement |
| PATCH | `/announcements/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update announcement |
| DELETE | `/announcements/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete announcement |
| GET | `/me/announcements` | Bearer | Any | Resident's community announcements |

### POST /communities/:cId/announcements

```json
{
  "title": "Corte de agua el jueves",
  "body": "Se interrumpirá el suministro de 9h a 13h.",
  "pinned": false
}
```

---

## Expenses

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/expenses` | Bearer | ADMIN_FINCAS, SUPPORT | List expenses |
| POST | `/communities/:cId/expenses` | Bearer | ADMIN_FINCAS, SUPPORT | Record expense |
| PATCH | `/expenses/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update expense |
| DELETE | `/expenses/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete expense |
| GET | `/me/expenses` | Bearer | Any | Expenses from my communities |

### POST /communities/:cId/expenses

```json
{
  "category": "CLEANING",
  "concept": "Servicio limpieza enero",
  "amount": 350.00,
  "expenseDate": "2024-01-31",
  "supplierId": "cld…",      // optional
  "attachmentUrl": "https://…" // optional
}
```

`category`: `CLEANING` | `LIFT` | `GARBAGE` | `GARDENING` | `MAINTENANCE` | `INSURANCE` | `ELECTRICITY` | `WATER` | `SECURITY` | `ADMIN_FEES` | `SUPPLIES` | `OTHER`

---

## Budgets

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/budgets` | Bearer | ADMIN_FINCAS, SUPPORT | Get budgets (all years) |
| GET | `/communities/:cId/budgets/:year` | Bearer | ADMIN_FINCAS, SUPPORT | Get budget for year |
| PUT | `/communities/:cId/budgets/:year` | Bearer | ADMIN_FINCAS, SUPPORT | Upsert budget for year |

### PUT /communities/:cId/budgets/:year

```json
{
  "lines": [
    { "category": "CLEANING", "amount": 4200.00 },
    { "category": "LIFT", "amount": 1500.00 }
  ]
}
```

---

## Suppliers

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/suppliers` | Bearer | ADMIN_FINCAS, SUPPORT | List suppliers |
| POST | `/communities/:cId/suppliers` | Bearer | ADMIN_FINCAS, SUPPORT | Create supplier |
| PATCH | `/communities/:cId/suppliers/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update supplier |
| DELETE | `/communities/:cId/suppliers/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete supplier |

### POST /communities/:cId/suppliers

```json
{
  "name": "Limpieza Rápida S.L.",
  "cif": "B12345678",
  "email": "contacto@limpiezarapida.es",
  "phone": "+34910000000",
  "address": "Calle Industria 5, Madrid",
  "notes": "Contrato anual"
}
```

---

## Procedures

Administrative procedures submitted by residents.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/procedures` | Bearer | ADMIN_FINCAS, SUPPORT | List community procedures |
| PATCH | `/procedures/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update status / resolution |
| POST | `/procedures/:id/updates` | Bearer | ADMIN_FINCAS, SUPPORT | Add admin update note |
| POST | `/me/procedures` (via `/procedures`) | Bearer | Any | Create procedure (resident) |
| GET | `/me/procedures` | Bearer | Any | Resident's own procedures |
| GET | `/procedures/:id` | Bearer | Any | Get procedure detail |

### POST /procedures (resident creates)

```json
{
  "communityId": "cld…",
  "type": "CERTIFICATE",
  "subject": "Certificado al corriente de pago",
  "description": "Lo necesito para la venta del piso.",
  "unitId": "cld…"
}
```

`type`: `CERTIFICATE` | `MAINTENANCE` | `DOCUMENT_REQUEST` | `COMPLAINT` | `PERMISSION` | `OTHER`

### PATCH /procedures/:id (admin updates)

```json
{
  "status": "COMPLETED",
  "resolution": "Certificado emitido y adjunto.",
  "attachmentUrl": "https://…"
}
```

`status`: `SUBMITTED` | `IN_REVIEW` | `IN_PROGRESS` | `COMPLETED` | `REJECTED`

---

## Tickets

Internal support tickets (user → Comugest support).

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/tickets` | Bearer | Any | Create ticket |
| GET | `/me/tickets` | Bearer | Any | My tickets |
| GET | `/tickets/:id` | Bearer | Any | Get ticket detail |
| PATCH | `/tickets/:id` | Bearer | Any (own) / SUPPORT | Update ticket |
| POST | `/tickets/:id/comments` | Bearer | Any | Add comment |
| GET | `/support/tickets` | Bearer | SUPPORT | All tickets (support view) |
| PATCH | `/support/tickets/:id` | Bearer | SUPPORT | Assign / change status |

### POST /tickets

```json
{
  "category": "BUG",
  "subject": "No puedo descargar el PDF",
  "description": "Al pulsar el botón aparece un error 500.",
  "priority": "HIGH",
  "pageUrl": "https://app.comugest.app/invoices/123",
  "userAgent": "Mozilla/5.0 …"
}
```

`category`: `BUG` | `FEATURE_REQUEST` | `QUESTION` | `BILLING` | `OTHER`
`priority`: `LOW` | `MEDIUM` | `HIGH` | `URGENT`

---

## Messages

Resident ↔ admin chat (one conversation per resident per community).

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/messages` | Bearer | Any | List conversations (admin: all in community; resident: own) |
| GET | `/messages/:conversationId` | Bearer | Any | Get conversation + messages |
| POST | `/messages/:conversationId` | Bearer | Any | Send a message |
| PATCH | `/messages/:conversationId/read` | Bearer | Any | Mark messages as read |

### POST /messages/:conversationId

```json
{ "body": "Hola, tengo una duda sobre la factura." }
```

---

## Meetings

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/meetings` | Bearer | ADMIN_FINCAS, SUPPORT | List meetings |
| POST | `/communities/:cId/meetings` | Bearer | ADMIN_FINCAS, SUPPORT | Create meeting |
| GET | `/meetings/:id` | Bearer | Any | Get meeting detail |
| PATCH | `/meetings/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update meeting |
| PATCH | `/meetings/:id/attendance` | Bearer | Any | Update own attendance |
| PUT | `/meetings/:id/minutes` | Bearer | ADMIN_FINCAS, SUPPORT | Save minutes text |
| PATCH | `/meetings/:id/minutes/publish` | Bearer | ADMIN_FINCAS, SUPPORT | Toggle published flag |
| POST | `/meetings/:id/minutes/sign` | Bearer | ADMIN_FINCAS, SUPPORT | Digitally sign minutes (TOTP) |
| GET | `/meetings/:id/minutes/pdf` | Bearer | Any | Download minutes PDF |
| GET | `/meetings/:id/convocatoria` | Bearer | ADMIN_FINCAS, SUPPORT | Download meeting notice PDF |
| POST | `/meetings/:id/qr-token` | Bearer | ADMIN_FINCAS, SUPPORT | Generate QR check-in token |
| POST | `/meetings/qr-check-in/:token` | None | — | QR check-in (from QR code) |
| GET | `/me/meetings` | Bearer | Any | Resident's meetings |

### POST /communities/:cId/meetings

```json
{
  "title": "Junta Ordinaria 2024",
  "type": "ORDINARY",
  "scheduledAt": "2024-03-15T18:00:00Z",
  "location": "Sala de reuniones planta baja",
  "agenda": "1. Aprobación presupuesto\n2. Ruegos y preguntas"
}
```

### PATCH /meetings/:id/attendance

```json
{ "status": "CONFIRMED" }
```

`status`: `PENDING` | `CONFIRMED` | `DECLINED` | `DELEGATED`

---

## Polls

Meeting polls and voting.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/meetings/:meetingId/polls` | Bearer | Any | List polls for meeting |
| POST | `/meetings/:meetingId/polls` | Bearer | ADMIN_FINCAS, SUPPORT | Create poll |
| PATCH | `/meetings/:meetingId/polls/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Close poll |
| POST | `/meetings/:meetingId/polls/:id/vote` | Bearer | Any | Cast vote |

### POST /meetings/:meetingId/polls

```json
{
  "question": "¿Aprobáis el presupuesto 2024?",
  "description": "Presupuesto total: 24.000 €",
  "votingDeadline": "2024-03-20T23:59:59Z",
  "requiresAttendance": false
}
```

### POST /meetings/:meetingId/polls/:id/vote

```json
{ "option": "FAVOR" }
```

`option`: `FAVOR` | `CONTRA` | `ABSTENCION`

---

## Common Areas & Reservations

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/areas` | Bearer | Any | List common areas |
| POST | `/communities/:cId/areas` | Bearer | ADMIN_FINCAS, SUPPORT | Create area |
| PATCH | `/areas/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update area |
| DELETE | `/areas/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete area |
| GET | `/communities/:cId/areas/:areaId/reservations` | Bearer | Any | List reservations for area |
| POST | `/communities/:cId/areas/:areaId/reservations` | Bearer | Any | Create reservation |
| DELETE | `/areas/reservations/:id` | Bearer | Any (own) | Cancel reservation |
| GET | `/me/reservations` | Bearer | Any | My reservations |

### POST /communities/:cId/areas

```json
{
  "name": "Piscina",
  "description": "Piscina comunitaria exterior",
  "capacity": 20,
  "openTime": "10:00",
  "closeTime": "22:00",
  "slotMinutes": 120,
  "maxSlotsPerDay": 1
}
```

### POST /communities/:cId/areas/:areaId/reservations

```json
{
  "startAt": "2024-07-15T10:00:00Z",
  "endAt": "2024-07-15T12:00:00Z",
  "notes": "Cumpleaños"
}
```

---

## Waitlist

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/me/waitlist` | Bearer | Any | My waitlist entries |
| POST | `/communities/:cId/areas/:areaId/waitlist` | Bearer | Any | Join waitlist |
| DELETE | `/communities/:cId/areas/:areaId/waitlist/:id` | Bearer | Any | Leave waitlist |

---

## Documents

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/documents` | Bearer | ADMIN_FINCAS, SUPPORT | List all community documents |
| POST | `/communities/:cId/documents` | Bearer | ADMIN_FINCAS, SUPPORT | Upload document record |
| PATCH | `/communities/:cId/documents/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update document metadata |
| DELETE | `/communities/:cId/documents/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete document |
| GET | `/me/documents` | Bearer | Any | Public documents for my communities |

### POST /communities/:cId/documents

```json
{
  "name": "Acta junta ordinaria 2023",
  "description": "Aprobada el 15/03/2023",
  "category": "ACTA",
  "url": "https://storage.example.com/…",
  "publicForResidents": true
}
```

`category`: `ACTA` | `REGLAMENTO` | `PRESUPUESTO` | `CONTRATO` | `CERTIFICADO` | `OTRO`

---

## Meter Readings

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/meter-readings` | Bearer | ADMIN_FINCAS, SUPPORT | List readings (optionally filter by unitId) |
| POST | `/communities/:cId/meter-readings` | Bearer | ADMIN_FINCAS, SUPPORT | Record reading |
| DELETE | `/communities/:cId/meter-readings/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete reading |

### POST /communities/:cId/meter-readings

```json
{
  "unitId": "cld…",
  "type": "AGUA",
  "readingDate": "2024-01-31",
  "value": 1234.567,
  "notes": "Lectura visita enero"
}
```

`type`: `AGUA` | `LUZ` | `GAS` | `OTRO`

---

## Incidents

Incident log book for a community.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/incidents` | Bearer | ADMIN_FINCAS, SUPPORT | List incidents |
| POST | `/communities/:cId/incidents` | Bearer | ADMIN_FINCAS, SUPPORT | Create incident |
| PATCH | `/communities/:cId/incidents/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update incident |

### POST /communities/:cId/incidents

```json
{
  "title": "Avería ascensor",
  "description": "El ascensor no responde desde las 08:00h.",
  "category": "LIFT",
  "photos": []
}
```

`category`: `GENERAL` | `STRUCTURAL` | `ELECTRICAL` | `PLUMBING` | `LIFT` | `FIRE` | `OTHER`

---

## Templates

Reusable message/announcement templates.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/templates` | Bearer | ADMIN_FINCAS, SUPPORT | List templates |
| POST | `/communities/:cId/templates` | Bearer | ADMIN_FINCAS, SUPPORT | Create template |
| PATCH | `/communities/:cId/templates/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Update template |
| DELETE | `/communities/:cId/templates/:id` | Bearer | ADMIN_FINCAS, SUPPORT | Delete template |

### POST /communities/:cId/templates

```json
{
  "name": "Convocatoria estándar",
  "subject": "Convocatoria junta de vecinos",
  "body": "Estimado/a vecino/a,\n\nLe convocamos a la junta…"
}
```

---

## Reports

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/reports/income-statement` | Bearer | ADMIN_FINCAS, SUPPORT | Income vs expenses summary |
| GET | `/communities/:cId/reports/delinquency` | Bearer | ADMIN_FINCAS, SUPPORT | Outstanding balances report |
| GET | `/communities/:cId/reports/modelo347` | Bearer | ADMIN_FINCAS, SUPPORT | Modelo 347 (Spain tax report) |

Query params: `year=2024`, `from=2024-01-01`, `to=2024-12-31`

---

## Calendar

Aggregated view of reservations, meetings, and procedures.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/calendar` | Bearer | ADMIN_FINCAS, SUPPORT | Community calendar events |
| GET | `/me/calendar` | Bearer | Any | My personal calendar events |

Query params: `from=2024-01-01&to=2024-01-31`

---

## Co-Admins

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/co-admins` | Bearer | ADMIN_FINCAS, SUPPORT | List co-admins |
| POST | `/communities/:cId/co-admins` | Bearer | ADMIN_FINCAS, SUPPORT | Add co-admin |
| DELETE | `/communities/:cId/co-admins/:userId` | Bearer | ADMIN_FINCAS, SUPPORT | Remove co-admin |

### POST /communities/:cId/co-admins

```json
{ "userId": "cld…" }
```

---

## Banking

GoCardless bank account integration.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/communities/:cId/banking` | Bearer | ADMIN_FINCAS, SUPPORT | List bank accounts |
| POST | `/communities/:cId/banking` | Bearer | ADMIN_FINCAS, SUPPORT | Add bank account |
| GET | `/communities/:cId/banking/:bankAccountId/transactions` | Bearer | ADMIN_FINCAS, SUPPORT | List transactions |
| PATCH | `/communities/:cId/banking/:bankAccountId/transactions/:transactionId/reconcile` | Bearer | ADMIN_FINCAS, SUPPORT | Reconcile transaction |

### POST /communities/:cId/banking

```json
{
  "institutionName": "CaixaBank",
  "iban": "ES91 2100 0418 4502 0005 1332"
}
```

---

## Notifications

In-app notifications (bell icon).

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/me/notifications` | Bearer | Any | List my notifications |
| PATCH | `/me/notifications/:id/read` | Bearer | Any | Mark as read |
| POST | `/me/notifications/mark-all-read` | Bearer | Any | Mark all as read |

---

## Push Subscriptions

Web Push (service worker).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/push/vapid-key` | None | Get VAPID public key |
| POST | `/push/subscribe` | Bearer | Register push subscription |
| DELETE | `/push/subscribe` | Bearer | Unregister push subscription |

### POST /push/subscribe

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": {
    "p256dh": "BNcRdreALRFXTkOOUHK…",
    "auth": "tBHItJI5svbpez7KI4CCXg"
  }
}
```

---

## Billing (Stripe)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/billing/status` | Bearer | Any | Get subscription status |
| POST | `/billing/checkout` | Bearer | ADMIN_FINCAS | Create Stripe Checkout session (subscription) |
| POST | `/billing/portal` | Bearer | ADMIN_FINCAS | Create Stripe Customer Portal session |
| POST | `/billing/webhook` | Raw body | — | Stripe webhook receiver |
| POST | `/billing/communities/:cId/invoices/:invoiceId/checkout` | Bearer | ADMIN_FINCAS, SUPPORT | Create Checkout for single invoice |

### GET /billing/status — response

```json
{
  "planStatus": "ACTIVE",
  "planCurrentPeriodEnd": "2024-12-31T23:59:59Z",
  "stripeSubscriptionId": "sub_…"
}
```

---

## Import (CSV)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/communities/:cId/import/csv` | Bearer | ADMIN_FINCAS, SUPPORT | Bulk import units/residents from CSV |

**Content-Type**: `multipart/form-data` with a `file` field containing the CSV.

Expected CSV columns: `type,label,floor,door,coefficient,ownerEmail,ownerFirstName,ownerLastName`

---

## Admin

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/admin/kpis` | Bearer | ADMIN_FINCAS, SUPPORT | Platform KPIs (communities, users, invoices) |

---

## Audit Log

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/admin/audit` | Bearer | ADMIN_FINCAS, SUPPORT | Query audit log |

Query params:

| Param | Type | Description |
|---|---|---|
| `communityId` | string | Filter by community |
| `action` | string | Filter by action enum value |
| `actorId` | string | Filter by user who performed the action |
| `from` | ISO date | Start of date range |
| `to` | ISO date | End of date range |
| `page` | number | Default 1 |
| `limit` | number | Default 20, max 100 |

**Response**
```json
{
  "data": [
    {
      "id": "cld…",
      "action": "INVOICE_CREATED",
      "actor": { "id": "cld…", "firstName": "Admin", "lastName": "User" },
      "targetType": "Invoice",
      "targetId": "cld…",
      "communityId": "cld…",
      "meta": { "concept": "Derrama ascensor", "totalAmount": 5000 },
      "createdAt": "2024-01-15T14:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```
