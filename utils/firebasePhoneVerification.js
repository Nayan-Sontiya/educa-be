const { getFirebaseAuth, isFirebaseAdminConfigured } = require("./firebaseAdmin");
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

  let auth;
  try {
    auth = getFirebaseAuth();
  } catch (initErr) {
    console.error("[firebase-phone] Admin init failed", initErr?.message || initErr);
    return {
      ok: false,
      status: 503,
      message:
        "Phone verification is unavailable (server Firebase Admin misconfigured).",
    };
  }

  try {
    const decoded = await auth.verifyIdToken(firebaseIdToken, false);

    const configProject = process.env.FIREBASE_PROJECT_ID;
    if (configProject && decoded.aud && decoded.aud !== configProject) {
      console.error("[firebase-phone] project mismatch", {
        tokenAud: decoded.aud,
        configProject,
      });
      return {
        ok: false,
        status: 503,
        message:
          "Phone verification server misconfigured (Firebase project mismatch).",
      };
    }

    const tokenPhone = phoneFromFirebaseE164(decoded.phone_number);
    if (!tokenPhone) {
      console.warn("[firebase-phone] ID token missing phone_number claim", {
        uid: decoded.uid,
        aud: decoded.aud,
        signInProvider: decoded.firebase?.sign_in_provider,
      });
      return {
        ok: false,
        status: 400,
        message:
          "Phone number was not verified by Firebase. Request OTP and try again.",
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
          "This code was sent to a different number. Request OTP again for the number in the form.",
      };
    }

    console.info("[firebase-phone] verified", {
      uid: decoded.uid,
      mobile: `******${tokenPhone.slice(-4)}`,
    });

    return { ok: true, mobileNormalized: tokenPhone, uid: decoded.uid };
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code;
    console.error("[firebase-phone] verifyIdToken failed", {
      code,
      message: err?.message,
      expected: `******${expected.slice(-4)}`,
    });

    if (code === "auth/id-token-expired") {
      return {
        ok: false,
        status: 400,
        message: "Verification expired. Request OTP again.",
      };
    }

    if (code === "auth/invalid-id-token" || code === "auth/argument-error") {
      return {
        ok: false,
        status: 400,
        message: "Could not verify SMS code. Request OTP and try again.",
      };
    }

    return {
      ok: false,
      status: 400,
      message: "Could not verify SMS code. Request OTP and try again.",
    };
  }
}

module.exports = {
  normalize10,
  phoneFromFirebaseE164,
  verifyFirebasePhoneIdToken,
};
