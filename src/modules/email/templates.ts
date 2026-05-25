import { env } from '../../config/env';

// ─── Definición de tipos por plantilla ──────────────────────

export interface TemplateVars {
  overdueReminder: {
    firstName: string;
    count: number;
    total: string;
  };
  emailVerification: {
    firstName: string;
    verificationUrl: string;
    expiresInHours: number;
  };
  invitation: {
    firstName: string;
    invitedByName: string;
    communityName: string;
    acceptUrl: string;
    expiresInDays: number;
  };
  passwordReset: {
    firstName: string;
    resetUrl: string;
    expiresInHours: number;
  };
  invoiceIssued: {
    firstName: string;
    communityName: string;
    unitLabel: string;
    concept: string;
    amount: string; // ya formateado con 2 decimales
    dueDate: string; // ISO YYYY-MM-DD
    viewUrl: string;
  };
  announcementPublished: {
    firstName: string;
    communityName: string;
    title: string;
    viewUrl: string;
  };
  paymentReminder: {
    firstName: string;
    communityName: string;
    unitLabel: string;
    concept: string;
    amount: string;
    dueDate: string;
    viewUrl: string;
  };
}

export type TemplateName = keyof TemplateVars;

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Locale = 'es' | 'en';

// ─── Layout base ────────────────────────────────────────────

function wrapHtml(content: string, footerText: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#faf7ec;font-family:Helvetica,Arial,sans-serif;color:#333a29;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#faf7ec;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff;border:1px solid #e9ecdf;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px;">
          <div style="font-family:Georgia,serif;font-size:22px;color:#3b442e;margin-bottom:24px;">Comugest</div>
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e9ecdf;background:#f6f7f2;color:#5d6c42;font-size:12px;">
          ${footerText}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Plantillas ─────────────────────────────────────────────

const templates = {
  overdueReminder: {
    es: (v: TemplateVars['overdueReminder']): RenderedEmail => ({
      subject: 'Tienes facturas vencidas en Comugest',
      text: `Hola ${v.firstName},\n\nTienes ${v.count} factura(s) vencidas por un total de ${v.total} €. Entra en Comugest para ponerte al día.\n\nComugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">Tienes <strong>${v.count}</strong> factura(s) vencidas por un total de <strong>${escapeHtml(v.total)} €</strong>. Entra en Comugest para ponerte al día.</p>`,
        'Comugest'
      ),
    }),
    en: (v: TemplateVars['overdueReminder']): RenderedEmail => ({
      subject: 'You have overdue invoices in Comugest',
      text: `Hi ${v.firstName},\n\nYou have ${v.count} overdue invoice(s) totalling €${v.total}. Log in to Comugest to view them.\n\nComugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">You have <strong>${v.count}</strong> overdue invoice(s) totalling <strong>€${escapeHtml(v.total)}</strong>. Log in to Comugest to view them.</p>`,
        'Comugest'
      ),
    }),
  },
  emailVerification: {
    es: (v: TemplateVars['emailVerification']): RenderedEmail => ({
      subject: 'Verifica tu correo en Comugest',
      text: `Hola ${v.firstName},

Para activar tu cuenta en Comugest, verifica tu correo haciendo clic en el siguiente enlace:

${v.verificationUrl}

Este enlace caduca en ${v.expiresInHours} horas. Si no has solicitado este registro, puedes ignorar este mensaje.

— El equipo de Comugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;font-size:16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 24px;line-height:1.6;">Para activar tu cuenta en Comugest, verifica tu correo electrónico haciendo clic en el botón:</p>
         <p style="margin:0 0 24px;"><a href="${v.verificationUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Verificar mi correo</a></p>
         <p style="margin:0 0 8px;font-size:13px;color:#5d6c42;">O copia este enlace en tu navegador:</p>
         <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${v.verificationUrl}" style="color:#485436;">${v.verificationUrl}</a></p>
         <p style="margin:0;font-size:13px;color:#5d6c42;">Este enlace caduca en ${v.expiresInHours} horas.</p>`,
        'Si no has solicitado este registro, puedes ignorar este mensaje.'
      ),
    }),
    en: (v: TemplateVars['emailVerification']): RenderedEmail => ({
      subject: 'Verify your email on Comugest',
      text: `Hi ${v.firstName},

To activate your Comugest account, please verify your email:

${v.verificationUrl}

This link expires in ${v.expiresInHours} hours.

— The Comugest team`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 24px;">To activate your Comugest account, verify your email by clicking the button:</p>
         <p style="margin:0 0 24px;"><a href="${v.verificationUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Verify my email</a></p>
         <p style="margin:0;font-size:13px;color:#5d6c42;">Expires in ${v.expiresInHours} hours.</p>`,
        "If you didn't request this signup, you can ignore this message."
      ),
    }),
  },

  invitation: {
    es: (v: TemplateVars['invitation']): RenderedEmail => ({
      subject: `${v.invitedByName} te ha invitado a Comugest`,
      text: `Hola ${v.firstName},

${v.invitedByName} (administrador de "${v.communityName}") te ha invitado a Comugest.

Para activar tu cuenta y crear tu contraseña:
${v.acceptUrl}

Esta invitación caduca en ${v.expiresInDays} días.

— El equipo de Comugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;line-height:1.6;"><strong>${escapeHtml(v.invitedByName)}</strong>, administrador de <em>${escapeHtml(v.communityName)}</em>, te ha invitado a Comugest.</p>
         <p style="margin:24px 0;"><a href="${v.acceptUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Activar mi cuenta</a></p>
         <p style="margin:0;font-size:13px;color:#5d6c42;">Esta invitación caduca en ${v.expiresInDays} días.</p>`,
        'Si crees que has recibido este correo por error, puedes ignorarlo.'
      ),
    }),
    en: (v: TemplateVars['invitation']): RenderedEmail => ({
      subject: `${v.invitedByName} invited you to Comugest`,
      text: `Hi ${v.firstName},

${v.invitedByName} (manager of "${v.communityName}") invited you to Comugest.

To activate your account: ${v.acceptUrl}

— The Comugest team`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">${escapeHtml(v.invitedByName)}, manager of <em>${escapeHtml(v.communityName)}</em>, has invited you to Comugest.</p>
         <p style="margin:24px 0;"><a href="${v.acceptUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Activate my account</a></p>
         <p style="margin:0;font-size:13px;color:#5d6c42;">Expires in ${v.expiresInDays} days.</p>`,
        'If you received this by mistake, you can ignore it.'
      ),
    }),
  },

  passwordReset: {
    es: (v: TemplateVars['passwordReset']): RenderedEmail => ({
      subject: 'Restablecer tu contraseña de Comugest',
      text: `Hola ${v.firstName},

Hemos recibido una solicitud para restablecer tu contraseña: ${v.resetUrl}

Caduca en ${v.expiresInHours} horas.

— El equipo de Comugest`,
      html: wrapHtml(
        `<p>Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
         <p><a href="${v.resetUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Restablecer</a></p>`,
        'Si no fuiste tú, ignora este mensaje.'
      ),
    }),
    en: (v: TemplateVars['passwordReset']): RenderedEmail => ({
      subject: 'Reset your Comugest password',
      text: `Hi ${v.firstName},

We received a request to reset your password: ${v.resetUrl}

Expires in ${v.expiresInHours} hours.`,
      html: wrapHtml(
        `<p>Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p>We received a request to reset your password.</p>
         <p><a href="${v.resetUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Reset</a></p>`,
        "If it wasn't you, ignore this message."
      ),
    }),
  },

  invoiceIssued: {
    es: (v: TemplateVars['invoiceIssued']): RenderedEmail => ({
      subject: `Nueva factura en ${v.communityName}: ${v.concept}`,
      text: `Hola ${v.firstName},

Tu administrador ha emitido una nueva factura para tu inmueble (${v.unitLabel}) en "${v.communityName}".

Concepto:     ${v.concept}
Importe:      ${v.amount} €
Vencimiento:  ${v.dueDate}

Puedes consultarla en la aplicación:
${v.viewUrl}

— El equipo de Comugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;line-height:1.6;">Tu administrador ha emitido una nueva factura para tu inmueble <strong>${escapeHtml(v.unitLabel)}</strong> en <em>${escapeHtml(v.communityName)}</em>.</p>
         <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:24px 0;font-size:14px;">
           <tr><td style="padding:6px 0;color:#5d6c42;">Concepto</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(v.concept)}</td></tr>
           <tr><td style="padding:6px 0;color:#5d6c42;border-top:1px solid #e9ecdf;">Importe</td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid #e9ecdf;font-size:18px;">${escapeHtml(v.amount)} €</td></tr>
           <tr><td style="padding:6px 0;color:#5d6c42;border-top:1px solid #e9ecdf;">Vencimiento</td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid #e9ecdf;">${escapeHtml(v.dueDate)}</td></tr>
         </table>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Ver factura</a></p>`,
        'Para cualquier duda sobre esta factura, contacta directamente con tu administrador.'
      ),
    }),
    en: (v: TemplateVars['invoiceIssued']): RenderedEmail => ({
      subject: `New invoice in ${v.communityName}: ${v.concept}`,
      text: `Hi ${v.firstName},

Your manager has issued a new invoice for your unit (${v.unitLabel}) at "${v.communityName}".

Concept:   ${v.concept}
Amount:    ${v.amount} €
Due date:  ${v.dueDate}

View it in the app: ${v.viewUrl}

— The Comugest team`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">Your manager has issued a new invoice for your unit <strong>${escapeHtml(v.unitLabel)}</strong> at <em>${escapeHtml(v.communityName)}</em>.</p>
         <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:24px 0;font-size:14px;">
           <tr><td style="padding:6px 0;color:#5d6c42;">Concept</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(v.concept)}</td></tr>
           <tr><td style="padding:6px 0;color:#5d6c42;border-top:1px solid #e9ecdf;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid #e9ecdf;font-size:18px;">${escapeHtml(v.amount)} €</td></tr>
           <tr><td style="padding:6px 0;color:#5d6c42;border-top:1px solid #e9ecdf;">Due date</td><td style="padding:6px 0;text-align:right;font-weight:600;border-top:1px solid #e9ecdf;">${escapeHtml(v.dueDate)}</td></tr>
         </table>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">View invoice</a></p>`,
        'For any question about this invoice, contact your manager directly.'
      ),
    }),
  },

  announcementPublished: {
    es: (v: TemplateVars['announcementPublished']): RenderedEmail => ({
      subject: `Nuevo anuncio en ${v.communityName}: ${v.title}`,
      text: `Hola ${v.firstName},

Tu administrador ha publicado un nuevo anuncio en "${v.communityName}":

${v.title}

Léelo completo en la aplicación:
${v.viewUrl}

— El equipo de Comugest`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;line-height:1.6;">Tu administrador ha publicado un nuevo anuncio en <em>${escapeHtml(v.communityName)}</em>:</p>
         <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#3b442e;">${escapeHtml(v.title)}</p>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Leer el anuncio</a></p>`,
        'Recibes este aviso porque tu administrador notifica los anuncios de tu comunidad.'
      ),
    }),
    en: (v: TemplateVars['announcementPublished']): RenderedEmail => ({
      subject: `New announcement in ${v.communityName}: ${v.title}`,
      text: `Hi ${v.firstName},

Your manager has posted a new announcement in "${v.communityName}":

${v.title}

Read it in the app: ${v.viewUrl}

— The Comugest team`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">Your manager has posted a new announcement in <em>${escapeHtml(v.communityName)}</em>:</p>
         <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#3b442e;">${escapeHtml(v.title)}</p>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Read announcement</a></p>`,
        'You receive this because your manager notifies community announcements.'
      ),
    }),
  },
  paymentReminder: {
    es: (v: TemplateVars['paymentReminder']): RenderedEmail => ({
      subject: `Recordatorio de pago: ${v.concept}`,
      text: `Hola ${v.firstName},\n\nTienes una factura pendiente de pago:\n\n- Concepto: ${v.concept}\n- Comunidad: ${v.communityName} (${v.unitLabel})\n- Importe: ${v.amount} €\n- Vencimiento: ${v.dueDate}\n\nPuedes ver el detalle en: ${v.viewUrl}\n\nSi ya has realizado el pago, ignora este mensaje.`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hola <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">Tienes una factura pendiente de pago para tu unidad <strong>${escapeHtml(v.unitLabel)}</strong> en <em>${escapeHtml(v.communityName)}</em>.</p>
         <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
           <tr><td style="padding:8px;color:#6b7280;">Concepto</td><td style="padding:8px;font-weight:600;">${escapeHtml(v.concept)}</td></tr>
           <tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;">Importe</td><td style="padding:8px;font-weight:600;">${escapeHtml(v.amount)} €</td></tr>
           <tr><td style="padding:8px;color:#6b7280;">Vencimiento</td><td style="padding:8px;">${escapeHtml(v.dueDate)}</td></tr>
         </table>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Ver factura</a></p>`,
        'Si ya has realizado el pago, ignora este mensaje.'
      ),
    }),
    en: (v: TemplateVars['paymentReminder']): RenderedEmail => ({
      subject: `Payment reminder: ${v.concept}`,
      text: `Hi ${v.firstName},\n\nYou have a pending invoice:\n\n- Concept: ${v.concept}\n- Community: ${v.communityName} (${v.unitLabel})\n- Amount: ${v.amount} €\n- Due: ${v.dueDate}\n\nView details at: ${v.viewUrl}\n\nIf you have already paid, please disregard this message.`,
      html: wrapHtml(
        `<p style="margin:0 0 16px;">Hi <strong>${escapeHtml(v.firstName)}</strong>,</p>
         <p style="margin:0 0 16px;">You have a pending invoice for your unit <strong>${escapeHtml(v.unitLabel)}</strong> at <em>${escapeHtml(v.communityName)}</em>.</p>
         <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
           <tr><td style="padding:8px;color:#6b7280;">Concept</td><td style="padding:8px;font-weight:600;">${escapeHtml(v.concept)}</td></tr>
           <tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;">Amount</td><td style="padding:8px;font-weight:600;">${escapeHtml(v.amount)} €</td></tr>
           <tr><td style="padding:8px;color:#6b7280;">Due date</td><td style="padding:8px;">${escapeHtml(v.dueDate)}</td></tr>
         </table>
         <p style="margin:24px 0;"><a href="${v.viewUrl}" style="display:inline-block;background:#485436;color:#faf7ec;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">View invoice</a></p>`,
        'If you have already paid, please disregard this message.'
      ),
    }),
  },
} as const;

export function renderTemplate<T extends TemplateName>(
  name: T,
  vars: TemplateVars[T],
  locale: Locale
): RenderedEmail {
  const localized = templates[name][locale] ?? templates[name].es;
  return localized(vars as never);
}

export function buildFrontendUrl(path: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
}
