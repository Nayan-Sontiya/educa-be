/**
 * Parent credential sharing.
 *
 * Firebase Phone Auth sends OTP SMS from the client SDK; Firebase Admin cannot send
 * arbitrary SMS text such as login credentials. The client sends Firebase OTP to the
 * parent phone, then shares login credentials via copy/WhatsApp in-app.
 */

function normalize10(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

async function sendParentCredentialsSms(
  phone,
  { schoolName, studentName, classSectionLabel, username, password },
) {
  const { buildParentLoginSmsMessage } = require("./parentCredentialsSms");
  const mobile = normalize10(phone);

  if (!mobile) {
    console.warn("[sms] Parent credential SMS skipped: invalid parent phone");
    return { ok: false, skipped: true, reason: "invalid_phone" };
  }

  const message = buildParentLoginSmsMessage({
    schoolName,
    studentName,
    classSectionLabel,
    username,
    password,
  });

  console.info("[sms] Parent credential SMS prepared for Firebase phone auth", {
    mobile: `******${mobile.slice(-4)}`,
  });

  return {
    ok: false,
    skipped: true,
    reason: "firebase_phone_auth_required",
    phone: mobile,
    message,
  };
}

module.exports = {
  sendParentCredentialsSms,
  normalize10,
};
