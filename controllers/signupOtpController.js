/**
 * Signup phone-verification OTP flow.
 *
 * Endpoints:
 *   POST /api/auth/signup/send-otp
 *   POST /api/auth/signup/verify-otp
 *
 * Issues a short-lived JWT (`phoneVerificationToken`) on successful
 * verification, which the client must include with the actual signup
 * request. The signup endpoint validates the token + the submitted phone
 * before creating the account.
 *
 * The send/verify mechanics (storage, attempt counting, SMS dispatch) live
 * in the shared `utils/mobileOtpService`; this file only handles the
 * signup-specific policy (user-exists check, JWT issuance).
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  createAndSendOtp,
  consumeOtp,
  normalize10,
  maskPhone,
} = require("../utils/mobileOtpService");

const PURPOSE = "signup_phone";
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_MAX = 3;
const RESEND_WINDOW_MS = 30 * 60 * 1000;
const PHONE_TOKEN_TTL = "15m";

/** POST /api/auth/signup/send-otp */
exports.sendSignupOtp = async (req, res) => {
  try {
    const { phone } = req.body || {};

    // Reject if a registered user already owns this number.
    const mobileNormalized = normalize10(phone || "");
    if (mobileNormalized) {
      const existingUser = await User.findOne({
        $or: [
          { phoneNormalized: mobileNormalized },
          { phone: mobileNormalized },
        ],
      })
        .select("_id")
        .lean();
      if (existingUser) {
        return res.status(409).json({
          message:
            "This mobile number is already registered. Please log in or use a different number.",
        });
      }
    }

    const result = await createAndSendOtp({
      phone,
      purpose: PURPOSE,
      ttlMs: OTP_TTL_MS,
      smsTemplate: (code) =>
        `UtthanAI signup OTP: ${code}. Valid 5 minutes. Do not share with anyone.`,
      resend: { windowMs: RESEND_WINDOW_MS, max: RESEND_MAX },
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.json({
      message: `OTP sent to ${result.maskedMobile}. Valid for 5 minutes.`,
      maskedMobile: result.maskedMobile,
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
    });
  } catch (err) {
    console.error("sendSignupOtp:", err);
    return res
      .status(500)
      .json({ message: "Could not send OTP. Please try again." });
  }
};

/** POST /api/auth/signup/verify-otp */
exports.verifySignupOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body || {};

    const result = await consumeOtp({
      phone,
      otp,
      purpose: PURPOSE,
      maxAttempts: MAX_ATTEMPTS,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    const phoneVerificationToken = jwt.sign(
      { typ: "phone_verified", phone: result.mobileNormalized },
      process.env.JWT_SECRET,
      { expiresIn: PHONE_TOKEN_TTL },
    );

    return res.json({
      message: "Mobile number verified successfully.",
      phoneVerificationToken,
      expiresIn: PHONE_TOKEN_TTL,
    });
  } catch (err) {
    console.error("verifySignupOtp:", err);
    return res.status(500).json({ message: "Could not verify OTP" });
  }
};

/**
 * Verify a `phoneVerificationToken` matches the supplied phone.
 * Returns `{ ok: true }` on success, otherwise `{ ok: false, message }`.
 * Exposed for use by registration controllers.
 */
exports.assertPhoneVerificationToken = (token, phone) => {
  if (!token || typeof token !== "string") {
    return {
      ok: false,
      message: "Please verify your mobile number with OTP before continuing.",
    };
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return {
      ok: false,
      message:
        "Phone verification expired. Please verify your mobile number again.",
    };
  }
  if (decoded?.typ !== "phone_verified" || !decoded?.phone) {
    return { ok: false, message: "Invalid phone verification token" };
  }
  const verifiedPhone = normalize10(decoded.phone);
  const claimedPhone = normalize10(phone);
  if (!verifiedPhone || !claimedPhone || verifiedPhone !== claimedPhone) {
    return {
      ok: false,
      message:
        "Mobile number does not match the verified number. Please verify again.",
    };
  }
  return { ok: true, phone: verifiedPhone };
};

// Re-exported so callers don't have to reach into the service directly.
exports._internal = { maskPhone };
