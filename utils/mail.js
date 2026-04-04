/**
 * Transactional email via Nodemailer (SMTP).
 *
 * Required when MAIL_ENABLED=true:
 *   SMTP_HOST, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_PORT (default 587), SMTP_SECURE (default false for 587)
 *   MAIL_FROM — e.g. "Educa <noreply@yourdomain.com>" (defaults to SMTP_USER)
 *   APP_PUBLIC_URL — used in links and default logo URL in HTML emails
 *   MAIL_BRAND_LOGO_URL — optional full URL to logo image (overrides defaults)
 *   API_PUBLIC_URL — optional API base URL; logo served at /brand/UtthanAI TB Logo.png
 */

const nodemailer = require("nodemailer");

function isMailEnabled() {
  return String(process.env.MAIL_ENABLED || "").toLowerCase() === "true";
}

function getTransporter() {
  if (!isMailEnabled()) return null;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure =
    process.env.SMTP_SECURE === "true" || String(port) === "465";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function getFromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@localhost";
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, logContext?: string }} opts
 * @returns {Promise<{ sent?: boolean, skipped?: boolean, reason?: string, messageId?: string, error?: Error }>}
 */
async function sendMail(opts) {
  const { to, subject, text, html, logContext } = opts;
  const tag = (action) =>
    logContext ? `[mail] ${action} [${logContext}]` : `[mail] ${action}`;

  if (!to || !subject || !text) {
    console.warn(tag("SKIP missing_fields"), {
      hasTo: !!to,
      hasSubject: !!subject,
      hasText: !!text,
    });
    return { skipped: true, reason: "missing_fields" };
  }

  if (!isMailEnabled()) {
    console.log(tag("SKIP mail_disabled"), {
      to,
      subjectPreview: subject.substring(0, 72),
    });
    return { skipped: true, reason: "mail_disabled" };
  }

  const transporter = getTransporter();
  const from = getFromAddress();

  if (!transporter) {
    console.warn(tag("SKIP smtp_incomplete"), {
      to,
      subjectPreview: subject.substring(0, 72),
      hint: "Set SMTP_HOST, SMTP_USER, SMTP_PASS when MAIL_ENABLED=true",
    });
    return { skipped: true, reason: "smtp_incomplete" };
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html:
        html ||
        `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    });
    console.log(tag("SENT"), {
      to,
      messageId: info.messageId,
      subjectPreview: subject.substring(0, 72),
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(tag("FAILED"), {
      to,
      subjectPreview: subject.substring(0, 72),
      error: err.message,
    });
    return { error: err };
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appBaseUrl() {
  const u = (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
  return u || "";
}

/**
 * Public URL for the full brand logo (PNG) in HTML emails.
 * Priority: MAIL_BRAND_LOGO_URL → API_PUBLIC_URL + /brand/... → APP_PUBLIC_URL + /images/logo/...
 */
function brandLogoUrl() {
  const explicit = (process.env.MAIL_BRAND_LOGO_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const api = (process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
  if (api) return `${api}/brand/UtthanAI TB Logo.png`;
  const app = appBaseUrl();
  if (app) return `${app}/images/logo/UtthanAI TB Logo.png`;
  return "";
}

/** Brand logo block for transactional HTML. */
function brandLogoImgHtml() {
  const url = brandLogoUrl();
  if (!url) return "";
  return `<div style="margin:0 0 20px 0;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
<img src="${escapeHtml(url)}" alt="Utthan Ai" width="220" style="display:block;max-width:220px;height:auto;border:0;" />
</div>`;
}

module.exports = {
  isMailEnabled,
  sendMail,
  escapeHtml,
  appBaseUrl,
  brandLogoUrl,
  brandLogoImgHtml,
};
