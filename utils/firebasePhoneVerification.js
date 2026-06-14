const { getFirebaseAdmin, isFirebaseAdminConfigured } = require("./firebaseAdmin");
const { normalizePhone } = require("./phone");

/** Last 10 digits of an Indian mobile number. */
function normalize10(phone) {
  const digits = normalizePhone(phone || "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

/** Parse Firebase E.164 phone (+91XXXXXXXXXX) to 10-digit Indian mobile. */
function phoneFromFirebaseE164(e164) {
  if (!e164) return "";
  const digits = String(e164).replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return "";
}

/**
 * Verify a Firebase ID token from client phone auth and ensure it matches expected phone.
 * @param {string} firebaseIdToken
 * @param {string} expectedPhone 10-digit or any normalized form
 */
async function verifyFirebasePhoneIdToken(firebaseIdToken, expectedPhone) {
  if (!isFirebaseAdminConfigured()) {
    return {
      ok: false,
      status: 503,
      message:
        "Phone verification is not configured on the server. Contact support.",
    };
  }

  if (!firebaseIdToken || typeof firebaseIdToken !== "string") {
    return {
      ok: false,
      status: 400,
      message: "Missing Firebase verification token.",
    };
  }

  const expected = normalize10(expectedPhone);
  if (!expected) {
    return {
      ok: false,
      status: 400,
      message: "Enter a valid 10-digit mobile number.",
    };
  }

  try {
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(firebaseIdToken);

    const tokenPhone = phoneFromFirebaseE164(decoded.phone_number);
    if (!tokenPhone) {
      console.warn("[firebase-phone] ID token has no phone_number claim", {
        uid: decoded.uid,
      });
      return {
        ok: false,
        status: 400,
        message: "Phone number was not verified by Firebase.",
      };
    }

    if (tokenPhone !== expected) {
      console.warn("[firebase-phone] phone mismatch", {
        expected: `******${expected.slice(-4)}`,
        token: `******${tokenPhone.slice(-4)}`,
        uid: decoded.uid,
      });
      return {
        ok: false,
        status: 400,
        message:
          "Mobile number does not match the verified Firebase session. Please try again.",
      };
    }

    console.info("[firebase-phone] verified", {
      uid: decoded.uid,
      mobile: `******${tokenPhone.slice(-4)}`,
    });

    return { ok: true, mobileNormalized: tokenPhone, uid: decoded.uid };
  } catch (err) {
    console.error("verifyFirebasePhoneIdToken:", err?.message || err);
    return {
      ok: false,
      status: 401,
      message: "Phone verification expired or invalid. Please verify again.",
    };
  }
}

module.exports = {
  normalize10,
  phoneFromFirebaseE164,
  verifyFirebasePhoneIdToken,
};
