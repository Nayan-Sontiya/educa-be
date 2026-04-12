const { sendMail, escapeHtml, appBaseUrl, brandLogoImgHtml } = require("./mail");

/* ─── Shared layout ───────────────────────────────────────────────────── */

const SUPPORT_EMAIL = "support@utthanai.com";
const BRAND = "UtthanAI";
const TAGLINE = "Empowering Education with AI";

function emailWrapper(bodyHtml) {
  const logo = brandLogoImgHtml();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${BRAND}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:28px 36px;text-align:center;">
            ${logo ? `<div style="margin-bottom:10px;">${logo}</div>` : ""}
            <p style="margin:0;color:#c7d2fe;font-size:13px;letter-spacing:1px;text-transform:uppercase;">${TAGLINE}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
            <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;">
              Need help? Write to us at
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">${SUPPORT_EMAIL}</a>
            </p>
            <p style="margin:0;color:#cbd5e1;font-size:11px;">© ${new Date().getFullYear()} ${BRAND}. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function headingHtml(text, color = "#1e1b4b") {
  return `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:${color};">${text}</h1>`;
}

function para(text) {
  return `<p style="margin:0 0 14px;font-size:15px;color:#334155;line-height:1.6;">${text}</p>`;
}

function ctaButton(label, href) {
  return `<div style="margin:24px 0;">
    <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#6366f1);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 32px;border-radius:8px;letter-spacing:0.3px;">${label}</a>
  </div>`;
}

function infoBox(rows) {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:8px 14px 8px 0;color:#64748b;font-size:13px;white-space:nowrap;font-weight:600;">${label}</td>
          <td style="padding:8px 0;color:#1e293b;font-size:13px;">${value}</td>
        </tr>`
    )
    .join("");
  return `<table cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;padding:12px 16px;margin:18px 0;width:100%;">${cells}</table>`;
}

function statusBadge(label, bg, color) {
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">${label}</span>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>`;
}

/* ─── 1. Registration received (pending approval) ─────────────────────── */

async function notifySchoolRegistered({ school, adminName }) {
  const to = school.email;
  if (!to) {
    console.warn("[mail] school_registered SKIP no_recipient", { schoolId: school._id });
    return { skipped: true, reason: "no_recipient" };
  }

  const name = school.name || "your school";
  const subject = `Registration received — ${name}`;

  const text =
    `Dear ${adminName || "School Administrator"},\n\n` +
    `Thank you for registering ${name} with ${BRAND}.\n\n` +
    `Your application has been received and is currently under review by our admin team.\n\n` +
    `What happens next?\n` +
    `Our team will verify your details. Once approved, you will receive a confirmation email with login access.\n\n` +
    `We appreciate your patience and look forward to supporting your institution.\n\n` +
    `If you have any questions, feel free to reach out to us at ${SUPPORT_EMAIL}.\n\n` +
    `Warm regards,\nTeam ${BRAND}\n${TAGLINE}`;

  const html = emailWrapper(`
    ${headingHtml("Registration Received! ⏳")}
    ${para(`Dear <strong>${escapeHtml(adminName || "School Administrator")}</strong>,`)}
    ${para(`Thank you for registering <strong>${escapeHtml(name)}</strong> with ${BRAND}. We're excited to have you onboard!`)}
    ${para(`Your application has been successfully received and is currently <strong>under review</strong> by our admin team.`)}
    ${divider()}
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:14px 16px;margin:18px 0;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#92400e;">⏳ What happens next?</p>
      <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">Our team will verify your details. Once approved, you will receive a confirmation email with login access to your school admin panel.</p>
    </div>
    ${divider()}
    ${para(`If you have any questions, feel free to reach out at <a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a>.`)}
    ${para(`<span style="color:#94a3b8;font-size:13px;">If you did not submit this registration, please ignore this email.</span>`)}
    ${para(`Warm regards,<br/><strong>Team ${BRAND}</strong>`)}
  `);

  console.log("[mail] school_registered attempt", { to, schoolId: school._id });
  return sendMail({ to, subject, text, html, logContext: "school_registered" });
}

/* ─── 2 / 3 / other. Status change emails ────────────────────────────── */

async function notifySchoolStatusChanged({
  school,
  previousStatus,
  newStatus,
  rejectionReason,
  reviewNote,
}) {
  const to = school.email;
  if (!to) {
    console.warn("[mail] school_status SKIP no_recipient", { schoolId: school._id, previousStatus, newStatus });
    return { skipped: true, reason: "no_recipient" };
  }

  console.log("[mail] school_status attempt", { to, schoolId: school._id, previousStatus, newStatus, sameStatus: previousStatus === newStatus });

  const name = school.name || "Your School";
  const signInUrl = appBaseUrl() ? `${appBaseUrl()}/signin` : "/signin";

  let subject;
  let bodyText;
  let bodyHtml;

  switch (newStatus) {
    /* ── Approved ── */
    case "Verified": {
      subject = `🎉 Approved! ${name} — Your account is ready`;
      bodyText =
        `Dear School Administrator,\n\n` +
        `Great news! Your registration with ${BRAND} has been successfully approved.\n\n` +
        `You can now access your school admin account:\n${signInUrl}\n\n` +
        `Login Credentials:\n` +
        `Email: ${school.email}\n` +
        `Password: (the one you set during registration)\n\n` +
        `We're excited to have you onboard and help you transform your educational experience.\n\n` +
        `If you need any assistance, our support team is always here to help at ${SUPPORT_EMAIL}.\n\n` +
        `Best regards,\nTeam ${BRAND}\n${TAGLINE}`;

      bodyHtml = emailWrapper(`
        ${headingHtml("You're Approved! 🎉", "#14532d")}
        ${statusBadge("Account Approved", "#dcfce7", "#166534")}
        <br/><br/>
        ${para(`Dear <strong>School Administrator</strong>,`)}
        ${para(`Great news! Your registration of <strong>${escapeHtml(name)}</strong> with ${BRAND} has been <strong>successfully approved</strong>.`)}
        ${para(`You can now access your school admin panel and start managing your institution.`)}
        ${divider()}
        ${infoBox([
          ["School", escapeHtml(name)],
          ["Email", escapeHtml(school.email || "—")],
          ["Password", "The one you set during registration"],
        ])}
        ${ctaButton("Sign In to Dashboard →", signInUrl)}
        ${divider()}
        ${para(`We're excited to have you onboard and help transform your educational experience with AI.`)}
        ${para(`If you need any assistance, reach out at <a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a>.`)}
        ${para(`Best regards,<br/><strong>Team ${BRAND}</strong>`)}
      `);
      break;
    }

    /* ── Rejected ── */
    case "Rejected": {
      const reason = rejectionReason || school.rejectionReason || "";
      subject = `Update on your registration — ${name}`;
      bodyText =
        `Dear School Administrator,\n\n` +
        `Thank you for your interest in ${BRAND}.\n\n` +
        `After reviewing your registration details, we regret to inform you that we are unable to approve your application at this time.\n\n` +
        (reason ? `Reason:\n${reason}\n\n` : "") +
        `We encourage you to review the above details and feel free to reapply once the issue has been resolved.\n\n` +
        `If you believe this was a mistake or need clarification, please contact us at ${SUPPORT_EMAIL}.\n\n` +
        `Thank you for your understanding.\n\nSincerely,\nTeam ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml("Application Status Update", "#7f1d1d")}
        ${statusBadge("Not Approved", "#fee2e2", "#991b1b")}
        <br/><br/>
        ${para(`Dear <strong>School Administrator</strong>,`)}
        ${para(`Thank you for your interest in <strong>${BRAND}</strong>.`)}
        ${para(`After reviewing your registration for <strong>${escapeHtml(name)}</strong>, we regret to inform you that we are <strong>unable to approve</strong> your application at this time.`)}
        ${reason
          ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;padding:14px 16px;margin:18px 0;">
              <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#991b1b;">📌 Reason</p>
              <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.6;">${escapeHtml(reason).replace(/\n/g, "<br/>")}</p>
            </div>`
          : ""}
        ${divider()}
        ${para(`We encourage you to review the details above and feel free to <strong>reapply</strong> once the issue has been resolved.`)}
        ${para(`If you believe this was a mistake or need clarification, please contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a>.`)}
        ${para(`Thank you for your understanding.<br/><br/><strong>Sincerely,<br/>Team ${BRAND}</strong>`)}
      `);
      break;
    }

    /* ── Need more info ── */
    case "NeedMoreInfo": {
      const note = reviewNote || school.reviewNote || "";
      subject = `Action required — More information needed for ${name}`;
      bodyText =
        `Dear School Administrator,\n\n` +
        `We need a bit more information to continue reviewing ${name}.\n\n` +
        (note ? `Message from the team:\n${note}\n\n` : "") +
        `Please reply to this email or contact us at ${SUPPORT_EMAIL} with the required details.\n\n` +
        `— Team ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml("Additional Information Required 📋", "#78350f")}
        ${statusBadge("Action Required", "#fef3c7", "#92400e")}
        <br/><br/>
        ${para(`Dear <strong>School Administrator</strong>,`)}
        ${para(`We're currently reviewing the registration for <strong>${escapeHtml(name)}</strong> and need a bit more information to proceed.`)}
        ${note
          ? `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:14px 16px;margin:18px 0;">
              <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#92400e;">Message from our team</p>
              <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">${escapeHtml(note).replace(/\n/g, "<br/>")}</p>
            </div>`
          : ""}
        ${divider()}
        ${para(`Please reply to this email or reach out at <a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a> with the required details.`)}
        ${para(`— <strong>Team ${BRAND}</strong>`)}
      `);
      break;
    }

    /* ── Blocked ── */
    case "Blocked":
      subject = `Important: ${name} has been blocked`;
      bodyText =
        `Your school "${name}" has been blocked on the platform.\n\n` +
        `School admin sign-in is disabled until this is resolved.\n` +
        `Please contact platform support at ${SUPPORT_EMAIL}.\n\n— Team ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml(`Account Blocked`, "#7f1d1d")}
        ${statusBadge("Blocked", "#fee2e2", "#991b1b")}
        <br/><br/>
        ${para(`Your school <strong>${escapeHtml(name)}</strong> has been <strong>blocked</strong> on the platform.`)}
        ${para(`School admin sign-in is currently disabled. Please contact platform support to resolve this.`)}
        ${para(`<a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a>`)}
        ${para(`— <strong>Team ${BRAND}</strong>`)}
      `);
      break;

    /* ── Suspended ── */
    case "Suspended":
      subject = `Notice: ${name} has been suspended`;
      bodyText =
        `Your school "${name}" has been temporarily suspended.\n\n` +
        `School admin access may be limited. Please contact platform support at ${SUPPORT_EMAIL}.\n\n— Team ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml(`Account Suspended`, "#78350f")}
        ${statusBadge("Suspended", "#fef3c7", "#92400e")}
        <br/><br/>
        ${para(`Your school <strong>${escapeHtml(name)}</strong> has been <strong>temporarily suspended</strong>.`)}
        ${para(`School admin access may be limited during this period. Please contact platform support for details.`)}
        ${para(`<a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5;">${SUPPORT_EMAIL}</a>`)}
        ${para(`— <strong>Team ${BRAND}</strong>`)}
      `);
      break;

    /* ── Pending ── */
    case "Pending":
      subject = `Status update — ${name} is pending review`;
      bodyText =
        `Your school "${name}" is now marked as pending review.\n\n` +
        `You will receive another email when the status changes.\n\n— Team ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml("Back Under Review ⏳")}
        ${statusBadge("Pending Review", "#e0e7ff", "#3730a3")}
        <br/><br/>
        ${para(`Your school <strong>${escapeHtml(name)}</strong> is now <strong>pending review</strong> again.`)}
        ${para(`You will receive another email as soon as there is an update on your application.`)}
        ${para(`— <strong>Team ${BRAND}</strong>`)}
      `);
      break;

    /* ── Default ── */
    default:
      subject = `School status update — ${name}`;
      bodyText =
        `The status of ${name} was updated to: ${newStatus}\n(Previous: ${previousStatus})\n\n— Team ${BRAND}`;

      bodyHtml = emailWrapper(`
        ${headingHtml("Status Update")}
        ${para(`The status of <strong>${escapeHtml(name)}</strong> has been updated to <strong>${escapeHtml(newStatus)}</strong>.`)}
        ${para(`Previous status: ${escapeHtml(previousStatus)}`)}
        ${para(`— <strong>Team ${BRAND}</strong>`)}
      `);
  }

  return sendMail({ to, subject, text: bodyText, html: bodyHtml, logContext: "school_verification_patch" });
}

module.exports = { notifySchoolRegistered, notifySchoolStatusChanged };
