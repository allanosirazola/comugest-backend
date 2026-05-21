# Comugest — Backend

API REST para la plataforma SaaS de administración de fincas.

## Stack

- **Node.js 20+** con **TypeScript**
- **Express** como framework HTTP
- **Prisma** ORM sobre **PostgreSQL**
- **JWT** (access + refresh con rotación) para autenticación
- **Zod** para validación de entradas
- **Bcrypt** para hashing de contraseñas
- **Jest + Supertest** para tests
- **Winston** para logging
- **Helmet + CORS + Rate limiting** para baseline de seguridad

## Estructura

```
src/
├── config/         # env, logger, prisma client
├── middleware/     # auth, errores
├── modules/
│   ├── auth/       # registro, login, verificación, refresh
│   ├── email/      # servicio + plantillas (provider intercambiable)
│   └── invitations/# admin invita vecino → vecino acepta
├── types/          # extensiones de tipos (Express.Request.user)
├── utils/          # jwt, password, tokens, errores, asyncHandler
├── app.ts          # construcción de la app Express
└── server.ts       # bootstrap con BD y graceful shutdown

prisma/
└── schema.prisma   # modelo de datos

tests/              # tests de integración
```

## Cómo arrancar en local

```bash
npm install
cp .env.example .env

# Levanta PostgreSQL
docker compose up -d

# Genera cliente Prisma y aplica migraciones
npm run prisma:generate
npm run prisma:migrate -- --name init

# Arranca en dev (hot reload)
npm run dev
```

La API queda en `http://localhost:4000`. Health check: `GET /health`.

## Endpoints actuales

### Auth

| Método | Ruta                                  | Descripción                                            | Auth |
| ------ | ------------------------------------- | ------------------------------------------------------ | ---- |
| POST   | `/api/v1/auth/register`               | Registro (devuelve 202: requiere verificar email)      | No   |
| POST   | `/api/v1/auth/verify-email`           | Verifica el email con un token y autentica             | No   |
| POST   | `/api/v1/auth/resend-verification`    | Reenvía el email de verificación                       | No   |
| POST   | `/api/v1/auth/login`                  | Login (requiere usuario `ACTIVE`)                      | No   |
| POST   | `/api/v1/auth/refresh`                | Rota tokens (revoca el anterior)                       | No   |
| POST   | `/api/v1/auth/logout`                 | Revoca el refresh token                                | No   |
| GET    | `/api/v1/auth/me`                     | Datos del usuario autenticado                          | Sí   |

### Invitaciones

| Método | Ruta                              | Descripción                                                | Auth                  |
| ------ | --------------------------------- | ---------------------------------------------------------- | --------------------- |
| POST   | `/api/v1/invitations`             | Admin crea invitación y envía email                        | Sí (ADMIN_FINCAS)     |
| GET    | `/api/v1/invitations/inspect?token=…` | Invitado consulta info pública de su invitación        | No                    |
| POST   | `/api/v1/invitations/accept`      | Invitado fija contraseña y activa cuenta                   | No                    |

## Flujo de email y verificación

### Auto-registro (admin de fincas o vecino)

1. `POST /auth/register` → user creado en estado `PENDING`, se genera token y se envía email.
2. Usuario hace clic en el enlace → frontend llama `POST /auth/verify-email` con el token.
3. User pasa a `ACTIVE`, se emiten access+refresh tokens y queda autenticado.

> En desarrollo (`EMAIL_PROVIDER=console`) los correos **no se envían**; el contenido entero —incluido el enlace— se loguea por consola. Búscalo en los logs y copia el enlace.

### Invitación por admin

1. Admin autenticado: `POST /invitations` con email, nombre, comunidad, unidad y tipo de relación (OWNER, OCCUPANT, BOTH).
2. Backend:
   - Verifica que el admin gestiona esa comunidad.
   - Crea `User` en estado `INVITED` (o reutiliza si ya existía como invitado).
   - Crea registros `Ownership` y/o `Occupancy` según la relación.
   - Genera token `INVITATION` y envía email al invitado.
3. Invitado hace clic en el enlace → frontend llama `GET /invitations/inspect?token=…` para mostrar info.
4. Invitado define contraseña → `POST /invitations/accept` → cuenta `ACTIVE` y login automático.

## Modelo de datos clave

El esquema separa **Unidad** (estructura física estable), **Titularidad** (Ownership, propiedad — cambia al vender) y **Ocupación** (Occupancy, quién vive ahora — cambia al alquilar). Las derramas se calculan con el `coefficient` de cada Unit.

Estados de usuario:
- `INVITED` — creado por admin, pendiente de aceptar invitación
- `PENDING` — auto-registrado, pendiente de verificar email
- `ACTIVE` — puede operar normalmente
- `DISABLED` — desactivado

Roles:
- `SUPPORT` — equipo interno
- `ADMIN_FINCAS` — cliente que paga el SaaS
- `VECINO` — propietario o inquilino

## Configuración de email

`.env`:

```
EMAIL_PROVIDER=console    # 'console' (dev) o 'smtp' (producción)
EMAIL_FROM="Comugest <no-reply@comugest.app>"
EMAIL_VERIFICATION_EXPIRES_HOURS=24
INVITATION_EXPIRES_DAYS=7
FRONTEND_URL=http://localhost:5173
```

Para producción, implementa `SmtpEmailProvider` en `src/modules/email/email.service.ts`. Tres opciones recomendadas, listas para enchufar:

- **Resend** (recomendado, DX simple) — `npm i resend`
- **Nodemailer + SMTP** — `npm i nodemailer`
- **AWS SES** — `npm i @aws-sdk/client-sesv2`

El shape de la interfaz `EmailProvider` ya está preparado.

## GDPR — checklist resumida implementada

- Contraseñas con bcrypt (factor 12 por defecto).
- Tokens de verificación e invitación: se guarda el **hash SHA-256**, no el token en claro.
- Refresh tokens guardados en BD y revocables individualmente. Rotación en cada uso.
- Cada usuario tiene `gdprAcceptedAt` y `gdprVersion` para auditoría de consentimientos.
- Campos custom de comunidad clasificados por categoría GDPR (`PERSONAL_BASIC`, `FINANCIAL`, `SENSITIVE`, etc).
- Rate limiting agresivo en endpoints de auth y reenvío de verificación.
- Login y reenvío de verificación responden **igual** existan o no el email (no filtran cuentas).

Falta por hacer (siguientes iteraciones):
- [ ] Endpoint de exportación de datos personales del usuario
- [ ] Endpoint de borrado (soft + hard) con auditoría
- [ ] Registro de tratamiento de datos
- [ ] Cifrado a nivel de columna para datos sensibles (IBAN, etc)

## Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

Los tests de integración requieren una BD `comugest_test`:

```sql
CREATE DATABASE comugest_test;
```

## Próximos pasos

- [ ] Módulo `communities` (CRUD)
- [ ] Módulo `units` (con campos custom)
- [ ] Módulo `messages` (WebSockets para chat tiempo real)
- [ ] Módulo `invoices` (facturas, derramas, reparto por coeficiente)
- [ ] Módulo `announcements` con notificaciones push
- [ ] Módulo `tickets` (reporte interno)
- [ ] Módulo `metrics` (panel SUPPORT)
- [ ] Recuperación de contraseña (la plantilla y el tipo de token ya existen)

---

## Módulos añadidos (iteración 4)

### Recuperación de contraseña
- `POST /api/v1/auth/forgot-password` — solicita reset (responde 204 siempre, no filtra emails)
- `POST /api/v1/auth/reset-password` — fija nueva contraseña con token; revoca todas las sesiones activas
- Token tipo `PASSWORD_RESET` (hash SHA-256), caduca en 2h

### Anuncios
- `GET/POST /api/v1/communities/:communityId/announcements` — admin
- `PATCH/DELETE /api/v1/announcements/:id` — admin
- `GET /api/v1/me/announcements` — vecino (anuncios de sus comunidades)
- Al publicar con `notify: true`, email a todos los propietarios/ocupantes activos (plantilla `announcementPublished`)

### Mensajería (chat admin ↔ vecino)
- `GET /api/v1/messages/conversations` — lista (vecino: las suyas; admin: las de sus comunidades) con conteo de no leídos
- `POST /api/v1/messages/conversations` — vecino inicia/recupera conversación con una comunidad
- `GET /api/v1/messages/conversations/:id/messages` — hilo (marca como leídos los del otro lado)
- `POST /api/v1/messages/conversations/:id/messages` — enviar
- Una conversación por (comunidad, vecino). Frontend hace polling (5s hilo, 10s lista).
- **Upgrade futuro a WebSockets:** sustituir el polling por un canal WS (socket.io o ws nativo) autenticando el handshake con el access token y emitiendo a salas por `conversationId`. El modelo de datos no cambia.

### `/me/communities`
- `GET /api/v1/me/communities` — comunidades a las que pertenece el usuario (cualquier rol). Lo usa el vecino para iniciar conversaciones.

## Nota sobre bcrypt
Se usa **bcryptjs** (JS puro) en vez de `bcrypt` (nativo) para evitar problemas de compilación/despliegue. La API es idéntica.

## Módulo añadido (iteración 5): Gastos de comunidad

Registro de gastos operativos por categoría (limpieza, ascensor, basuras, jardinería, mantenimiento, seguro, luz, agua, seguridad, honorarios, suministros, otros).

- `GET/POST /api/v1/communities/:communityId/expenses` — admin (lista con filtros `from`/`to`/`category` + resumen por categoría con %)
- `PATCH/DELETE /api/v1/expenses/:id` — admin
- `GET /api/v1/me/expenses?communityId=` — vecino (transparencia, solo lectura; no ve proveedor interno ni quién lo registró)

El resumen por categoría (total, conteo y porcentaje) se calcula en el servicio. El frontend lo pinta con un desglose de barras CSS sin dependencias externas. Importes en `Decimal`.

## Módulo añadido (iteración 6): Tickets de soporte y métricas

Sistema interno de incidencias. Cualquier usuario reporta; el equipo SUPPORT gestiona.

- `POST /api/v1/tickets` — crear ticket (cualquier usuario; adjunta URL y user-agent para diagnóstico)
- `GET /api/v1/me/tickets` — mis tickets
- `GET /api/v1/tickets/:id` — detalle (el reporter no ve notas internas)
- `POST /api/v1/tickets/:id/comments` — comentar (solo SUPPORT puede marcar `internal`)
- `PATCH /api/v1/tickets/:id` — estado/prioridad/asignación (solo SUPPORT)
- `GET /api/v1/support/tickets?status=&category=&priority=` — cola completa (solo SUPPORT)
- `GET /api/v1/support/metrics` — métricas de uso (usuarios por rol, comunidades, unidades, facturas activas, tickets por estado/categoría, altas últimos 30 días)

### Usuario SUPPORT
El registro público solo permite VECINO/ADMIN_FINCAS. Los usuarios de soporte se crean con el seed:

```bash
npm run prisma:seed
# Crea support@comugest.app / Support1234 (configurable con SEED_SUPPORT_EMAIL / SEED_SUPPORT_PASSWORD)
```

**Cambia esas credenciales en producción.**

## Módulo añadido (iteración 7): Gestión de trámites

El vecino presenta trámites a la administración; el admin los gestiona con estado, resolución e hilo de comunicación.

Tipos: certificado, incidencia/avería, solicitud de documento, queja, permiso, otros.
Estados: presentado → en revisión → en trámite → resuelto / rechazado.

- `POST /api/v1/procedures` — el vecino presenta un trámite (en una comunidad a la que pertenece)
- `GET /api/v1/me/procedures` — mis trámites
- `GET /api/v1/procedures/:id` — detalle (requester o admin de la comunidad; devuelve `canManage`)
- `PATCH /api/v1/procedures/:id` — estado/resolución/documento (solo admin de la comunidad)
- `POST /api/v1/procedures/:id/updates` — añadir mensaje al hilo (requester o admin)
- `GET /api/v1/communities/:communityId/procedures?status=&type=` — cola del admin

Al marcar COMPLETED/REJECTED se fija `resolvedAt` y queda registrado el admin que lo gestionó (`handledById`).
