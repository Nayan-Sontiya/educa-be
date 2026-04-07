const { sendMail, escapeHtml, appBaseUrl, brandLogoImgHtml } = require("./mail");

/**
 * After successful school registration (pending approval).
 */
async function notifySchoolRegistered({ school, adminName }) {
  const to = school.email;
  if (!to) {
    console.warn("[mail] school_registered SKIP no_recipient", {
      schoolId: school._id,
    });
    return { skipped: true, reason: "no_recipient" };
  }

  const name = school.name || "your school";
  const subject = `We received your school registration — ${name}`;

  const text = `Hello ${adminName || "there"},

Thank you for registering ${name} on our platform.

Your application is pending review by our team. You will receive another email when your school's status changes.

You will be able to sign in as school admin only after your school is approved.

If you did not submit this registration, please ignore this email.

— UtthanAI`;

  const html = `${brandLogoImgHtml()}
  <p>Hello ${escapeHtml(adminName || "there")},</p>
  <p>Thank you for registering <strong>${escapeHtml(name)}</strong> on our platform.</p>
  <p>Your application is <strong>pending review</strong>. You will receive another email when your school's status changes.</p>
  <p>You will be able to sign in as school admin only after your school is approved.</p>
  <p style="color:#666;font-size:12px;">If you did not submit this registration, please ignore this email.</p>
  <p>— UtthanAI</p>`;

  console.log("[mail] school_registered attempt", { to, schoolId: school._id });
  return sendMail({
    to,
    subject,
    text,
    html,
    logContext: "school_registered",
  });
}

/**
 * When platform admin changes verification status.
 */
async function notifySchoolStatusChanged({
  school,
  previousStatus,
  newStatus,
  rejectionReason,
  reviewNote,
}) {
  const to = school.email;
  if (!to) {
    console.warn("[mail] school_status SKIP no_recipient", {
      schoolId: school._id,
      previousStatus,
      newStatus,
    });
    return { skipped: true, reason: "no_recipient" };
  }

  console.log("[mail] school_status attempt", {
    to,
    schoolId: school._id,
    previousStatus,
    newStatus,
    sameStatus: previousStatus === newStatus,
  });

  const name = school.name || "Your school";
  const signInUrl = appBaseUrl() ? `${appBaseUrl()}/signin` : "/signin";

  let subject;
  let bodyText;
  let bodyHtml;

  switch (newStatus) {
    case "Verified":
      subject = `Approved: ${name} — you can sign in now`;
      bodyText = `Good news — ${name} has been approved on our platform.

You can now sign in as school admin:
${appBaseUrl() ? signInUrl : "Use the sign-in page on our website."}

— UtthanAI`;
      bodyHtml = `<p>Good news — <strong>${escapeHtml(name)}</strong> has been <strong>approved</strong>.</p>
<p>You can now <a href="${escapeHtml(signInUrl)}">sign in as school admin</a>.</p>
<p>— UtthanAI</p>`;
      break;

    case "Rejected": {
      const reason = rejectionReason || school.rejectionReason || "";
      subject = `Update on your school registration — ${name}`;
      bodyText = `Your school registration for ${name} was not approved.

${reason ? `Reason:\n${reason}\n\n` : ""}If you have questions, please contact platform support.

— UtthanAI`;
      bodyHtml = `<p>Your school registration for <strong>${escapeHtml(name)}</strong> was <strong>not approved</strong>.</p>
${reason ? `<p><strong>Reason:</strong><br/>${escapeHtml(reason).replace(/\n/g, "<br/>")}</p>` : ""}
<p>If you have questions, please contact platform support.</p>
<p>— UtthanAI</p>`;
      break;
    }

    case "NeedMoreInfo": {
      const note = reviewNote || school.reviewNote || "";
      subject = `More information needed — ${name}`;
      bodyText = `We need a bit more information to continue reviewing ${name}.

${note ? `Message from the team:\n${note}\n\n` : ""}Please reply or update your application as instructed by support.

— UtthanAI`;
      bodyHtml = `<p>We need more information to continue reviewing <strong>${escapeHtml(name)}</strong>.</p>
${note ? `<p><strong>Message from the team:</strong><br/>${escapeHtml(note).replace(/\n/g, "<br/>")}</p>` : ""}
<p>Please follow any instructions you received from support.</p>
<p>— UtthanAI</p>`;
      break;
    }

    case "Blocked":
      subject = `Important: ${name} has been blocked`;
      bodyText = `Your school "${name}" has been blocked on the platform.

School admin sign-in is disabled until this is resolved. Please contact platform support.

— UtthanAI`;
      bodyHtml = `<p>Your school <strong>${escapeHtml(name)}</strong> has been <strong>blocked</strong> on the platform.</p>
<p>School admin sign-in is disabled until this is resolved. Please contact platform support.</p>
<p>— UtthanAI</p>`;
      break;

    case "Suspended":
      subject = `Notice: ${name} has been suspended`;
      bodyText = `Your school "${name}" has been temporarily suspended.

School admin access may be limited. Please contact platform support for details.

— UtthanAI`;
      bodyHtml = `<p>Your school <strong>${escapeHtml(name)}</strong> has been <strong>suspended</strong>.</p>
<p>School admin access may be limited. Please contact platform support.</p>
<p>— UtthanAI</p>`;
      break;

    case "Pending":
      subject = `Status update — ${name} is pending review`;
      bodyText = `Your school "${name}" is now marked as pending review again.

You will receive another email when the status changes.

— UtthanAI`;
      bodyHtml = `<p>Your school <strong>${escapeHtml(name)}</strong> is now <strong>pending review</strong> again.</p>
<p>You will receive another email when the status changes.</p>
<p>— UtthanAI</p>`;
      break;

    default:
      subject = `School status update — ${name}`;
      bodyText = `The status of ${name} was updated to: ${newStatus}
(Previous: ${previousStatus})

— UtthanAI`;
      bodyHtml = `<p>The status of <strong>${escapeHtml(name)}</strong> was updated to <strong>${escapeHtml(newStatus)}</strong>.</p>
<p>Previous status: ${escapeHtml(previousStatus)}</p>
<p>— UtthanAI</p>`;
  }

  bodyHtml = brandLogoImgHtml() + bodyHtml;

  return sendMail({
    to,
    subject,
    text: bodyText,
    html: bodyHtml,
    logContext: "school_verification_patch",
  });
}

module.exports = {
  notifySchoolRegistered,
  notifySchoolStatusChanged,
};
