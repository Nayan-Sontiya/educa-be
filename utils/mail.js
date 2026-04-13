/**
 * Transactional email via Nodemailer (SMTP).
 *
 * Required when MAIL_ENABLED=true:
 *   SMTP_HOST, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_PORT (default 587), SMTP_SECURE (default false for 587)
 *   SMTP_FORCE_IPV4=true — if ETIMEDOUT on CONN (env is fine): force IPv4; common on VPS with broken IPv6
 *   MAIL_FROM — e.g. "Educa <noreply@yourdomain.com>" (defaults to SMTP_USER)
 *   APP_PUBLIC_URL — used in links and default logo URL in HTML emails
 *   MAIL_BRAND_LOGO_URL — optional full URL to logo image (overrides defaults)
 *   API_PUBLIC_URL — optional API base URL; logo served at /brand/UtthanAI final Logo.PNG
 */

const dns = require("dns");
const nodemailer = require("nodemailer");

function isMailEnabled() {
  return String(process.env.MAIL_ENABLED || "").toLowerCase() === "true";
}

function maskEmailForLog(email) {
  if (!email || typeof email !== "string") return null;
  const at = email.indexOf("@");
  if (at < 1) return "(invalid)";
  return `***@${email.slice(at + 1)}`;
}

/** Safe SMTP-related env for logs (no passwords). */
function smtpEnvForLog() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const portRaw = process.env.SMTP_PORT || "587";
  const port = parseInt(portRaw, 10);
  const secure =
    process.env.SMTP_SECURE === "true" || String(port) === "465";
  const forceIpv4 =
    String(process.env.SMTP_FORCE_IPV4 || "").toLowerCase() === "true";

  return {
    MAIL_ENABLED_raw: process.env.MAIL_ENABLED,
    mailEnabledParsed: isMailEnabled(),
    SMTP_HOST: host ? host : "(empty)",
    SMTP_HOST_set: !!host,
    SMTP_PORT_raw: portRaw,
    SMTP_PORT_parsed: Number.isFinite(port) ? port : `(invalid: ${portRaw})`,
    SMTP_SECURE_raw: process.env.SMTP_SECURE ?? "(unset)",
    secureComputed: secure,
    SMTP_USER_set: !!user,
    SMTP_USER_mask: maskEmailForLog(user),
    SMTP_PASS_set: !!pass,
    SMTP_PASS_length: pass ? pass.length : 0,
    MAIL_FROM_set: !!process.env.MAIL_FROM,
    MAIL_FROM_preview: (process.env.MAIL_FROM || "").substring(0, 72) || "(unset)",
    SMTP_FORCE_IPV4: forceIpv4,
  };
}

function nodemailerErrorFields(err) {
  if (!err || typeof err !== "object") return {};
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    errno: err.errno,
    syscall: err.syscall,
    address: err.address,
    port: err.port,
    command: err.command,
    responseCode: err.responseCode,
    response: err.response,
  };
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

  const forceIpv4 =
    String(process.env.SMTP_FORCE_IPV4 || "").toLowerCase() === "true";
  const lookup = forceIpv4
    ? (hostname, opts, cb) =>
        dns.lookup(hostname, { ...(opts || {}), family: 4 }, cb)
    : undefined;

  const transport = {
    host,
    port,
    secure,
    auth: { user, pass },
  };
  if (lookup) {
    transport.lookup = lookup;
  }

  return nodemailer.createTransport(transport);
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
      env: { MAIL_ENABLED_raw: process.env.MAIL_ENABLED },
    });
    return { skipped: true, reason: "mail_disabled" };
  }

  const transporter = getTransporter();
  const from = getFromAddress();

  if (!transporter) {
    console.warn(tag("SKIP smtp_incomplete"), {
      to,
      subjectPreview: subject.substring(0, 72),
      ...smtpEnvForLog(),
      missing: {
        SMTP_HOST: !process.env.SMTP_HOST,
        SMTP_USER: !process.env.SMTP_USER,
        SMTP_PASS: !process.env.SMTP_PASS,
      },
      hint: "Set SMTP_HOST, SMTP_USER, SMTP_PASS when MAIL_ENABLED=true",
    });
    return { skipped: true, reason: "smtp_incomplete" };
  }

  console.log(tag("ATTEMPT"), {
    to,
    subjectPreview: subject.substring(0, 72),
    fromPreview: from.substring(0, 72),
    ...smtpEnvForLog(),
  });

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
    const fields = nodemailerErrorFields(err);
    const timedOutOnConnect =
      fields.code === "ETIMEDOUT" && fields.command === "CONN";
    console.error(tag("FAILED"), {
      to,
      subjectPreview: subject.substring(0, 72),
      ...fields,
      env: smtpEnvForLog(),
      ...(timedOutOnConnect
        ? {
            hint:
              "TCP to SMTP never connected (not auth). Try SMTP_FORCE_IPV4=true on the server, or allow outbound 587/465, or use SendGrid/SES (HTTPS).",
          }
        : {}),
    });
    if (err && err.stack) {
      console.error(tag("FAILED stack"), err.stack);
    }
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
  if (api) return `${api}/brand/UtthanAI final Logo.PNG`;
  const app = appBaseUrl();
  if (app) return `${app}/images/logo/UtthanAI final Logo.PNG`;
  return "";
}

/** Brand logo block for transactional HTML. */
function brandLogoImgHtml() {
  const url = brandLogoUrl();
  if (!url) return "";
  return `<div style="margin:0 0 20px 0;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
<img src="${escapeHtml(url)}" alt="UtthanAI" width="220" style="display:block;max-width:220px;height:auto;border:0;" />
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
