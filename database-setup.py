#!/usr/bin/env python3
"""
database-setup.py — Inicializa la BBDD de Comugest en Railway (o cualquier Postgres).

Crea todos los tipos enum, tablas, restricciones, índices y FKs definidos en
``prisma/schema.prisma``. Es idempotente: ejecutarlo dos veces no falla.

Uso:
    export DATABASE_URL="postgresql://user:pass@host:port/dbname"
    pip install psycopg2-binary bcrypt
    python database-setup.py                    # crea todo si no existe
    python database-setup.py --drop             # borra y recrea todo
    python database-setup.py --seed             # crea usuario SUPPORT
    python database-setup.py --drop --seed      # full reset

Notas:
    * La fuente de verdad del esquema es ``prisma/schema.prisma``. Este script
      replica esa estructura DDL para entornos donde no quieras correr Node
      (CI, scripting de ops, provisión rápida en Railway). Si vas a seguir
      usando ``prisma migrate``, lo canónico es ``npx prisma migrate deploy``;
      este script NO escribe en ``_prisma_migrations``.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Iterable

try:
    import psycopg2  # type: ignore
    from psycopg2 import sql  # noqa: F401
except ImportError:
    print("Falta psycopg2. Instala con: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


# ─── Definiciones DDL en orden de dependencias ──────────────────────────────

ENUMS: list[tuple[str, list[str]]] = [
    ("UserRole", ["SUPPORT", "ADMIN_FINCAS", "VECINO"]),
    ("UserStatus", ["INVITED", "PENDING", "ACTIVE", "DISABLED"]),
    ("VerificationTokenType", ["EMAIL_VERIFICATION", "INVITATION", "PASSWORD_RESET"]),
    ("UnitType", ["VIVIENDA", "LOCAL", "GARAJE", "TRASTERO"]),
    ("FieldDataType", ["STRING", "NUMBER", "BOOLEAN", "DATE", "JSON"]),
    ("GdprCategory", ["NONE", "PERSONAL_BASIC", "PERSONAL_CONTACT", "FINANCIAL", "SENSITIVE"]),
    ("InvoiceType", ["DERRAMA", "INDIVIDUAL"]),
    ("PaymentMethod", ["BANK_TRANSFER", "CARD", "CASH", "DIRECT_DEBIT", "OTHER"]),
    ("ExpenseCategory", [
        "CLEANING", "LIFT", "GARBAGE", "GARDENING", "MAINTENANCE", "INSURANCE",
        "ELECTRICITY", "WATER", "SECURITY", "ADMIN_FEES", "SUPPLIES", "OTHER",
    ]),
    ("TicketCategory", ["BUG", "FEATURE_REQUEST", "QUESTION", "BILLING", "OTHER"]),
    ("TicketStatus", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
    ("TicketPriority", ["LOW", "MEDIUM", "HIGH", "URGENT"]),
    ("ProcedureType", [
        "CERTIFICATE", "MAINTENANCE", "DOCUMENT_REQUEST",
        "COMPLAINT", "PERMISSION", "OTHER",
    ]),
    ("ProcedureStatus", [
        "SUBMITTED", "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "REJECTED",
    ]),
]


# Tablas y sus FKs. El orden importa: padres antes que hijos.
TABLES_DDL: list[str] = [
    # ─── Usuarios y auth ────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "passwordHash" TEXT,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT NOT NULL,
        "phone" TEXT,
        "role" "UserRole" NOT NULL,
        "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
        "emailVerifiedAt" TIMESTAMP(3),
        "locale" TEXT NOT NULL DEFAULT 'es',
        "gdprAcceptedAt" TIMESTAMP(3),
        "gdprVersion" TEXT,
        "lastLoginAt" TIMESTAMP(3),
        "invitedById" TEXT REFERENCES "User"("id"),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "RefreshToken" (
        "id" TEXT PRIMARY KEY,
        "token" TEXT NOT NULL UNIQUE,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "revokedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "VerificationToken" (
        "id" TEXT PRIMARY KEY,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "type" "VerificationTokenType" NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "usedAt" TIMESTAMP(3),
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Comunidad y estructura ─────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Community" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "city" TEXT NOT NULL,
        "postalCode" TEXT NOT NULL,
        "country" TEXT NOT NULL DEFAULT 'ES',
        "cif" TEXT,
        "redirectMessagesTo" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "CommunityAdmin" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("communityId", "userId")
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "Unit" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "type" "UnitType" NOT NULL,
        "label" TEXT NOT NULL,
        "floor" TEXT,
        "door" TEXT,
        "coefficient" DECIMAL(8,5) NOT NULL DEFAULT 0,
        "surfaceM2" DECIMAL(8,2),
        "customFields" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("communityId", "label")
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "Ownership" (
        "id" TEXT PRIMARY KEY,
        "unitId" TEXT NOT NULL REFERENCES "Unit"("id") ON DELETE CASCADE,
        "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endDate" TIMESTAMP(3),
        "sharePct" DECIMAL(5,2) NOT NULL DEFAULT 100.00,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "Occupancy" (
        "id" TEXT PRIMARY KEY,
        "unitId" TEXT NOT NULL REFERENCES "Unit"("id") ON DELETE CASCADE,
        "occupantId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "isOwner" BOOLEAN NOT NULL DEFAULT TRUE,
        "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endDate" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "CustomFieldDefinition" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "key" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "dataType" "FieldDataType" NOT NULL,
        "gdprCategory" "GdprCategory" NOT NULL DEFAULT 'NONE',
        "legalBasis" TEXT,
        "retentionDays" INTEGER,
        "isRequired" BOOLEAN NOT NULL DEFAULT FALSE,
        "appliesTo" TEXT NOT NULL DEFAULT 'UNIT',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("communityId", "key")
    );
    """,
    # ─── Facturación ────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Invoice" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "type" "InvoiceType" NOT NULL,
        "concept" TEXT NOT NULL,
        "description" TEXT,
        "totalAmount" DECIMAL(12,2) NOT NULL,
        "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "dueDate" TIMESTAMP(3) NOT NULL,
        "attachmentUrl" TEXT,
        "issuedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "cancelledAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "InvoiceItem" (
        "id" TEXT PRIMARY KEY,
        "invoiceId" TEXT NOT NULL REFERENCES "Invoice"("id") ON DELETE CASCADE,
        "unitId" TEXT NOT NULL REFERENCES "Unit"("id") ON DELETE RESTRICT,
        "amount" DECIMAL(12,2) NOT NULL,
        "consumptionValue" DECIMAL(12,3),
        "consumptionUnit" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("invoiceId", "unitId")
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "Payment" (
        "id" TEXT PRIMARY KEY,
        "invoiceItemId" TEXT NOT NULL REFERENCES "InvoiceItem"("id") ON DELETE CASCADE,
        "amount" DECIMAL(12,2) NOT NULL,
        "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
        "reference" TEXT,
        "notes" TEXT,
        "registeredById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Anuncios ───────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Announcement" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
        "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Mensajería ─────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Conversation" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("communityId", "residentId")
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "Message" (
        "id" TEXT PRIMARY KEY,
        "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
        "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "fromAdmin" BOOLEAN NOT NULL,
        "body" TEXT NOT NULL,
        "readAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Gastos ─────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Expense" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "category" "ExpenseCategory" NOT NULL,
        "concept" TEXT NOT NULL,
        "description" TEXT,
        "amount" DECIMAL(12,2) NOT NULL,
        "expenseDate" TIMESTAMP(3) NOT NULL,
        "supplier" TEXT,
        "attachmentUrl" TEXT,
        "recordedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Tickets ────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Ticket" (
        "id" TEXT PRIMARY KEY,
        "reporterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "category" "TicketCategory" NOT NULL,
        "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
        "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
        "subject" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "pageUrl" TEXT,
        "userAgent" TEXT,
        "assignedToId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "resolvedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "TicketComment" (
        "id" TEXT PRIMARY KEY,
        "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
        "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "body" TEXT NOT NULL,
        "internal" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    # ─── Trámites ───────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS "Procedure" (
        "id" TEXT PRIMARY KEY,
        "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
        "requesterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "type" "ProcedureType" NOT NULL,
        "status" "ProcedureStatus" NOT NULL DEFAULT 'SUBMITTED',
        "subject" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "unitId" TEXT REFERENCES "Unit"("id") ON DELETE SET NULL,
        "resolution" TEXT,
        "attachmentUrl" TEXT,
        "handledById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "resolvedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS "ProcedureUpdate" (
        "id" TEXT PRIMARY KEY,
        "procedureId" TEXT NOT NULL REFERENCES "Procedure"("id") ON DELETE CASCADE,
        "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
        "body" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
]


INDEXES_DDL: list[str] = [
    'CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");',
    'CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");',
    'CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");',
    'CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");',
    'CREATE INDEX IF NOT EXISTS "VerificationToken_userId_type_idx" ON "VerificationToken"("userId","type");',
    'CREATE INDEX IF NOT EXISTS "Community_name_idx" ON "Community"("name");',
    'CREATE INDEX IF NOT EXISTS "CommunityAdmin_userId_idx" ON "CommunityAdmin"("userId");',
    'CREATE INDEX IF NOT EXISTS "Unit_communityId_idx" ON "Unit"("communityId");',
    'CREATE INDEX IF NOT EXISTS "Ownership_unitId_idx" ON "Ownership"("unitId");',
    'CREATE INDEX IF NOT EXISTS "Ownership_ownerId_idx" ON "Ownership"("ownerId");',
    'CREATE INDEX IF NOT EXISTS "Ownership_endDate_idx" ON "Ownership"("endDate");',
    'CREATE INDEX IF NOT EXISTS "Occupancy_unitId_idx" ON "Occupancy"("unitId");',
    'CREATE INDEX IF NOT EXISTS "Occupancy_occupantId_idx" ON "Occupancy"("occupantId");',
    'CREATE INDEX IF NOT EXISTS "Invoice_communityId_issueDate_idx" ON "Invoice"("communityId","issueDate");',
    'CREATE INDEX IF NOT EXISTS "Invoice_dueDate_idx" ON "Invoice"("dueDate");',
    'CREATE INDEX IF NOT EXISTS "InvoiceItem_unitId_idx" ON "InvoiceItem"("unitId");',
    'CREATE INDEX IF NOT EXISTS "Payment_invoiceItemId_idx" ON "Payment"("invoiceItemId");',
    'CREATE INDEX IF NOT EXISTS "Payment_paidAt_idx" ON "Payment"("paidAt");',
    'CREATE INDEX IF NOT EXISTS "Announcement_communityId_publishedAt_idx" ON "Announcement"("communityId","publishedAt");',
    'CREATE INDEX IF NOT EXISTS "Conversation_communityId_lastMessageAt_idx" ON "Conversation"("communityId","lastMessageAt");',
    'CREATE INDEX IF NOT EXISTS "Conversation_residentId_idx" ON "Conversation"("residentId");',
    'CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId","createdAt");',
    'CREATE INDEX IF NOT EXISTS "Expense_communityId_expenseDate_idx" ON "Expense"("communityId","expenseDate");',
    'CREATE INDEX IF NOT EXISTS "Expense_communityId_category_idx" ON "Expense"("communityId","category");',
    'CREATE INDEX IF NOT EXISTS "Ticket_status_priority_idx" ON "Ticket"("status","priority");',
    'CREATE INDEX IF NOT EXISTS "Ticket_reporterId_idx" ON "Ticket"("reporterId");',
    'CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt");',
    'CREATE INDEX IF NOT EXISTS "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId","createdAt");',
    'CREATE INDEX IF NOT EXISTS "Procedure_communityId_status_idx" ON "Procedure"("communityId","status");',
    'CREATE INDEX IF NOT EXISTS "Procedure_requesterId_idx" ON "Procedure"("requesterId");',
    'CREATE INDEX IF NOT EXISTS "ProcedureUpdate_procedureId_createdAt_idx" ON "ProcedureUpdate"("procedureId","createdAt");',
]


# Orden inverso para DROP (hijos antes que padres)
TABLES_FOR_DROP: list[str] = [
    "ProcedureUpdate", "Procedure", "TicketComment", "Ticket", "Expense",
    "Message", "Conversation", "Announcement", "Payment", "InvoiceItem",
    "Invoice", "CustomFieldDefinition", "Occupancy", "Ownership", "Unit",
    "CommunityAdmin", "Community", "VerificationToken", "RefreshToken", "User",
]


# ─── Helpers ────────────────────────────────────────────────────────────────

def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL no está definido en el entorno.", file=sys.stderr)
        sys.exit(2)
    return url


def execute_many(cur, statements: Iterable[str]) -> None:
    for stmt in statements:
        cur.execute(stmt)


def create_enum_if_missing(cur, name: str, values: list[str]) -> None:
    cur.execute(
        """
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = %s AND n.nspname = current_schema()
        """,
        (name,),
    )
    if cur.fetchone():
        return
    vals_sql = ", ".join([f"'{v}'" for v in values])
    cur.execute(f'CREATE TYPE "{name}" AS ENUM ({vals_sql});')


def drop_everything(cur) -> None:
    for tbl in TABLES_FOR_DROP:
        cur.execute(f'DROP TABLE IF EXISTS "{tbl}" CASCADE;')
    for enum_name, _ in ENUMS:
        cur.execute(f'DROP TYPE IF EXISTS "{enum_name}" CASCADE;')


def create_schema(cur) -> None:
    for enum_name, values in ENUMS:
        create_enum_if_missing(cur, enum_name, values)
    execute_many(cur, TABLES_DDL)
    execute_many(cur, INDEXES_DDL)


def seed_support_user(cur) -> None:
    """Crea el usuario SUPPORT inicial si no existe."""
    try:
        import bcrypt  # type: ignore
    except ImportError:
        print(
            "ATENCIÓN: bcrypt no está instalado; saltando seed. "
            "Instala con: pip install bcrypt",
            file=sys.stderr,
        )
        return

    email = os.environ.get("SEED_SUPPORT_EMAIL", "support@comugest.app")
    password = os.environ.get("SUPPORT_PASSWORD", os.environ.get("SEED_SUPPORT_PASSWORD", "Support1234"))

    cur.execute('SELECT 1 FROM "User" WHERE "email" = %s', (email,))
    if cur.fetchone():
        print(f"  ↪ Usuario SUPPORT ya existe: {email}")
        return

    pwd_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

    # Generamos un id estilo cuid simple (no es cuid real, pero válido como PK)
    import secrets
    user_id = "seed_" + secrets.token_hex(12)

    cur.execute(
        """
        INSERT INTO "User" (
            "id", "email", "passwordHash", "firstName", "lastName",
            "role", "status", "emailVerifiedAt",
            "gdprAcceptedAt", "gdprVersion",
            "createdAt", "updatedAt"
        ) VALUES (
            %s, %s, %s, 'Equipo', 'Soporte',
            'SUPPORT', 'ACTIVE', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP, '2025-01-01',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """,
        (user_id, email, pwd_hash),
    )
    print(f"  ✓ Usuario SUPPORT creado: {email}")


# ─── Main ───────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--drop", action="store_true", help="Borrar todas las tablas/enums antes de crear")
    parser.add_argument("--seed", action="store_true", help="Crear usuario SUPPORT al final")
    args = parser.parse_args()

    url = get_database_url()
    conn = psycopg2.connect(url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            if args.drop:
                print("→ Borrando esquema previo…")
                drop_everything(cur)

            print("→ Creando enums, tablas e índices…")
            create_schema(cur)

            if args.seed:
                print("→ Sembrando usuario SUPPORT…")
                seed_support_user(cur)

        conn.commit()
        print("✅ Listo.")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"❌ Falló la inicialización: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
