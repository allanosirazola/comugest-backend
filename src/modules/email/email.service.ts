import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { renderTemplate, type TemplateName, type TemplateVars } from './templates';

// ─── Interfaz pública ───────────────────────────────────────

export interface SendEmailParams<T extends TemplateName> {
  to: string;
  template: T;
  vars: TemplateVars[T];
  locale?: 'es' | 'en';
}

export interface EmailProvider {
  send(args: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

// ─── Provider de desarrollo ─────────────────────────────────
// No envía nada; loguea el email entero por consola para que el
// desarrollador pueda copiar el enlace de verificación directamente.

class ConsoleEmailProvider implements EmailProvider {
  async send({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }): Promise<void> {
    logger.info('━━━━━━━━ EMAIL (dev) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`  Para:    ${to}`);
    logger.info(`  Asunto:  ${subject}`);
    logger.info('  ─ Texto plano ─');
    text.split('\n').forEach((line) => logger.info(`  ${line}`));
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    // Evitamos warnings sobre html no usado: el provider real lo usaría.
    void html;
  }
}

// ─── Provider SMTP (stub, listo para conectar) ──────────────
// Para producción: implementa con nodemailer / Resend / SES.
// Dejo el shape preparado para que enchufar el provider real sea 1 commit.

class SmtpEmailProvider implements EmailProvider {
  async send(_args: { to: string; subject: string; html: string; text: string }): Promise<void> {
    // TODO: integración real. Ejemplo con nodemailer:
    //
    //   import nodemailer from 'nodemailer';
    //   const transporter = nodemailer.createTransport({ ... });
    //   await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
    //
    // O con Resend:
    //   import { Resend } from 'resend';
    //   const resend = new Resend(env.RESEND_API_KEY);
    //   await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html, text });
    throw new Error('SMTP provider no implementado. Configura nodemailer/Resend/SES.');
  }
}

// ─── Factoría ───────────────────────────────────────────────

function buildProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmailProvider();
    case 'console':
    default:
      return new ConsoleEmailProvider();
  }
}

const provider = buildProvider();

// ─── API pública ────────────────────────────────────────────

export async function sendEmail<T extends TemplateName>(params: SendEmailParams<T>): Promise<void> {
  const locale = params.locale ?? 'es';
  const { subject, html, text } = renderTemplate(params.template, params.vars, locale);
  await provider.send({ to: params.to, subject, html, text });
}
