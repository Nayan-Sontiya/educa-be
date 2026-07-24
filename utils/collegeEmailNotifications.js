const { sendMail } = require("./mail");

const BRAND = "UtthanAI";
const SUPPORT_EMAIL = "support@utthanai.com";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function notifyCollegeRegistered({ college, representativeName }) {
  const to = college.officialEmail;
  if (!to) {
    console.warn("[mail] college_registered SKIP no_recipient", { collegeId: college._id });
    return { skipped: true, reason: "no_recipient" };
  }

  const name = college.name || "your college";
  const subject = `College Registration Received — ${name}`;

  const text =
    `Dear ${representativeName || "College Representative"},\n\n` +
    `Thank you for registering ${name} on ${BRAND}.\n\n` +
    `Your application has been received and is currently under review by our Super Admin team.\n\n` +
    `What happens next?\n` +
    `Our team will verify your institutional details. Once approved, you will be able to access your dashboard.\n\n` +
    `If you have any questions, reach out to us at ${SUPPORT_EMAIL}.\n\n` +
    `Warm regards,\nTeam ${BRAND}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:28px 36px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${BRAND}</p>
            <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Empowering Education with AI</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1e1b4b;">College Registration Received! ⏳</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Dear <strong>${escapeHtml(representativeName || "College Representative")}</strong>,</p>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Thank you for registering <strong>${escapeHtml(name)}</strong> with ${BRAND}. Your application is currently <strong>under review</strong> by our Super Admin team.</p>
            <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:14px 16px;margin:20px 0;">
              <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#92400e;">⏳ What happens next?</p>
              <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">Our team will verify your institutional details. Once approved, you will receive a confirmation email with full access to your college dashboard.</p>
            </div>
            <p style="margin:20px 0 0;font-size:15px;color:#334155;">Warm regards,<br/><strong>Team ${BRAND}</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    return await sendMail({
      to,
      subject,
      text,
      html,
      logContext: "college_registered",
    });
  } catch (err) {
    console.error("notifyCollegeRegistered error:", err.message);
    return { error: err.message };
  }
}

async function notifyCollegeStatusChanged({ college, newStatus, reason }) {
  const to = college.officialEmail;
  if (!to) {
    console.warn("[mail] college_status_change SKIP no_recipient", { collegeId: college._id });
    return { skipped: true, reason: "no_recipient" };
  }

  const name = college.name || "your college";
  const repName = college.representative?.name || "College Representative";
  let subject = `College Account Update — ${name}`;
  let statusTitle = "College Status Updated";
  let bodyText = `Your college account status has been updated to: ${newStatus}.`;

  if (newStatus === "Verified") {
    subject = `🎉 College Approved — Welcome to ${BRAND}!`;
    statusTitle = "Congratulations! Your College is Approved 🎉";
    bodyText = `We are pleased to inform you that <strong>${escapeHtml(name)}</strong> has been verified and approved. You can now log in using your official email and password to access your college portal.`;
  } else if (newStatus === "Rejected") {
    subject = `Update regarding your college registration — ${name}`;
    statusTitle = "College Registration Update";
    bodyText = `Your registration for <strong>${escapeHtml(name)}</strong> has been reviewed. Unfortunately, it was not approved at this time.${reason ? `<br/><br/><strong>Reason:</strong> ${escapeHtml(reason)}` : ""}<br/><br/>Please contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> for more information.`;
  } else if (newStatus === "Suspended") {
    subject = `Notice: College Account Suspended — ${name}`;
    statusTitle = "College Account Suspended";
    bodyText = `Your college account for <strong>${escapeHtml(name)}</strong> has been suspended.<br/><br/>Please contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> for details regarding your account standing.`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:28px 36px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${BRAND}</p>
            <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Empowering Education with AI</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1e1b4b;">${statusTitle}</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">Dear <strong>${escapeHtml(repName)}</strong>,</p>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">${bodyText}</p>
            <p style="margin:20px 0 0;font-size:15px;color:#334155;">Warm regards,<br/><strong>Team ${BRAND}</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    return await sendMail({
      to,
      subject,
      text: `${statusTitle}\n\n${bodyText.replace(/<[^>]+>/g, "")}\n\nTeam ${BRAND}`,
      html,
      logContext: "college_status_change",
    });
  } catch (err) {
    console.error("notifyCollegeStatusChanged error:", err.message);
    return { error: err.message };
  }
}

module.exports = { notifyCollegeRegistered, notifyCollegeStatusChanged };
