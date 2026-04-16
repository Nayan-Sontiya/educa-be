/**
 * Transactional email: SMTP (Nodemailer) or Resend (HTTPS, for hosts that block 587/465).
 *
 * MAIL_ENABLED=true plus either:
 *
 * A) SMTP — when MAIL_TRANSPORT=smtp, or when MAIL_TRANSPORT is unset and RESEND_API_KEY is not set
 *   SMTP_HOST, SMTP_USER, SMTP_PASS
 *   Optional: SMTP_PORT (587), SMTP_SECURE, SMTP_FORCE_IPV4=true (broken IPv6)
 *
 * B) Resend (HTTPS) — when MAIL_TRANSPORT=resend, or when RESEND_API_KEY is set (unless MAIL_TRANSPORT=smtp)
 *   RESEND_API_KEY — required for Resend; uses official `resend` package
 *   RESEND_FROM — sender; domain verified in Resend (or Resend test addresses)
 *
 * Shared: MAIL_FROM used as fallback for display/from where applicable
 *   APP_PUBLIC_URL, MAIL_BRAND_LOGO_URL, API_PUBLIC_URL — HTML email / logo URLs
 */

const dns = require("dns");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");

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
    MAIL_TRANSPORT_env: process.env.MAIL_TRANSPORT || "(unset)",
    effectiveTransport: mailTransportMode(),
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

/** @returns {"smtp" | "resend"} */
function mailTransportMode() {
  const raw = (process.env.MAIL_TRANSPORT || "").toLowerCase().trim();
  if (raw === "resend") return "resend";
  if (raw === "smtp") return "smtp";
  const key = process.env.RESEND_API_KEY;
  if (key && String(key).trim()) return "resend";
  return "smtp";
}

function resendEnvForLog() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  return {
    MAIL_TRANSPORT_env: process.env.MAIL_TRANSPORT || "(unset)",
    effectiveTransport: mailTransportMode(),
    RESEND_API_KEY_set: !!key,
    RESEND_API_KEY_length: key ? key.length : 0,
    RESEND_FROM_set: !!(from && String(from).trim()),
    RESEND_FROM_preview: (from || "").substring(0, 72) || "(unset)",
  };
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, logContext?: string }} opts
 * @param {(a: string) => string} tag
 */
async function sendMailResend(opts, tag) {
  const { to, subject, text, html } = opts;
  const key = process.env.RESEND_API_KEY;
  const fromRaw =
    (process.env.RESEND_FROM && process.env.RESEND_FROM.trim()) ||
    getFromAddress();

  if (!key) {
    console.warn(tag("SKIP resend_incomplete"), {
      to,
      subjectPreview: subject.substring(0, 72),
      ...resendEnvForLog(),
      hint: "Set RESEND_API_KEY (and RESEND_FROM for production). MAIL_TRANSPORT=resend is optional if the key is set.",
    });
    return { skipped: true, reason: "resend_incomplete" };
  }

  const bodyHtml =
    html ||
    `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`;

  console.log(tag("ATTEMPT resend"), {
    to,
    subjectPreview: subject.substring(0, 72),
    fromPreview: fromRaw.substring(0, 72),
    ...resendEnvForLog(),
  });

  try {
    const resend = new Resend(key.trim());
    const { data, error } = await resend.emails.send({
      from: fromRaw,
      to,
      subject,
      text,
      html: bodyHtml,
    });

    if (error) {
      const msg =
        (error && (error.message || error.name)) || "Resend API error";
      const err = new Error(String(msg));
      if (error.statusCode != null) err.responseCode = error.statusCode;
      err.response = typeof error === "object" ? JSON.stringify(error) : "";
      const msgLower = String(msg).toLowerCase();
      const domainHint =
        error.statusCode === 403 &&
        (msgLower.includes("not verified") || msgLower.includes("domain"))
          ? "Add the sender domain in Resend → Domains, publish DNS records, wait for Verified. Or use RESEND_FROM with an already-verified domain (dev: onboarding@resend.dev per Resend docs)."
          : undefined;
      console.error(tag("FAILED resend"), {
        to,
        subjectPreview: subject.substring(0, 72),
        resendError: error,
        ...resendEnvForLog(),
        ...(domainHint ? { hint: domainHint } : {}),
      });
      return { error: err };
    }

    const messageId = data && data.id ? String(data.id) : undefined;
    console.log(tag("SENT resend"), {
      to,
      messageId,
      subjectPreview: subject.substring(0, 72),
    });
    return { sent: true, messageId };
  } catch (err) {
    console.error(tag("FAILED resend"), {
      to,
      subjectPreview: subject.substring(0, 72),
      error: err.message,
      ...resendEnvForLog(),
    });
    if (err && err.stack) {
      console.error(tag("FAILED resend stack"), err.stack);
    }
    return { error: err };
  }
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

  if (mailTransportMode() === "resend") {
    return sendMailResend(opts, tag);
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

  console.log(tag("ATTEMPT smtp"), {
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
    console.log(tag("SENT smtp"), {
      to,
      messageId: info.messageId,
      subjectPreview: subject.substring(0, 72),
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const fields = nodemailerErrorFields(err);
    const timedOutOnConnect =
      fields.code === "ETIMEDOUT" && fields.command === "CONN";
    const snap = smtpEnvForLog();
    console.error(tag("FAILED smtp"), {
      to,
      subjectPreview: subject.substring(0, 72),
      ...fields,
      env: snap,
      ...(timedOutOnConnect
        ? {
            hint: snap.SMTP_FORCE_IPV4
              ? "Outbound SMTP is still blocked or unroutable. Set RESEND_API_KEY + RESEND_FROM (HTTPS :443), or ask your host to allow TCP 587/465 to the internet."
              : "TCP to SMTP never connected (not auth). Try SMTP_FORCE_IPV4=true, open outbound 587/465, or set RESEND_API_KEY (+ RESEND_FROM) to use Resend.",
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
  mailTransportMode,
  sendMail,
  escapeHtml,
  appBaseUrl,
  brandLogoUrl,
  brandLogoImgHtml,
};
