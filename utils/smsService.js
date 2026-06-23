/**
 * Parent credential sharing.
 *
 * Firebase Phone Auth sends OTP messages from the client SDK only; Firebase Admin
 * cannot send arbitrary SMS text such as login credentials. Server-side SMS
 * delivery has been removed, so callers receive a payload that the mobile client
 * can pass to the device SMS composer.
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

  console.info("[sms] Parent credential SMS prepared for client composer", {
    mobile: `******${mobile.slice(-4)}`,
  });

  return {
    ok: false,
    skipped: true,
    reason: "client_sms_composer_required",
    phone: mobile,
    message,
  };
}

module.exports = {
  sendParentCredentialsSms,
  normalize10,
};
