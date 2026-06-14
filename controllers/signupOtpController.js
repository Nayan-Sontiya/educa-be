/**
 * Signup phone verification via Firebase Phone Auth (client sends SMS; server verifies ID token).
 *
 * Endpoints:
 *   POST /api/auth/signup/send-otp     — phone availability check (no SMS from backend)
 *   POST /api/auth/signup/verify-otp   — body: { phone, firebaseIdToken }
 */
const User = require("../models/User");
const {
  normalize10,
  maskPhone,
} = require("../utils/mobileOtpService");
const { verifyFirebasePhoneIdToken } = require("../utils/firebasePhoneVerification");
const {
  issuePhoneVerificationToken,
  assertPhoneVerificationToken,
  DEFAULT_TTL,
} = require("../utils/phoneVerificationJwt");
const {
  isPhoneBlockedForTeacherSignup,
} = require("../utils/teacherRegistration");

function isTeacherSignupPurpose(body) {
  const purpose = String(body?.purpose || "").trim().toLowerCase();
  return purpose === "teacher" && body?.schoolId;
}

/** POST /api/auth/signup/send-otp — check phone is free; client sends OTP via Firebase */
exports.sendSignupOtp = async (req, res) => {
  try {
    const { phone } = req.body || {};
    const mobileNormalized = normalize10(phone || "");

    if (!mobileNormalized) {
      return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
    }

    if (isTeacherSignupPurpose(req.body)) {
      const blocked = await isPhoneBlockedForTeacherSignup(
        req.body.schoolId,
        mobileNormalized,
      );
      if (blocked.blocked) {
        return res.status(409).json({ message: blocked.message });
      }
    } else {
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

    return res.json({
      message: `You can receive an OTP on ${maskPhone(mobileNormalized)}.`,
      maskedMobile: maskPhone(mobileNormalized),
      provider: "firebase",
    });
  } catch (err) {
    console.error("sendSignupOtp:", err);
    return res
      .status(500)
      .json({ message: "Could not start phone verification. Please try again." });
  }
};

/** POST /api/auth/signup/verify-otp — verify Firebase ID token */
exports.verifySignupOtp = async (req, res) => {
  try {
    const { phone, firebaseIdToken } = req.body || {};

    const result = await verifyFirebasePhoneIdToken(firebaseIdToken, phone);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    if (isTeacherSignupPurpose(req.body)) {
      const blocked = await isPhoneBlockedForTeacherSignup(
        req.body.schoolId,
        result.mobileNormalized,
      );
      if (blocked.blocked) {
        return res.status(409).json({ message: blocked.message });
      }
    } else {
      const existingUser = await User.findOne({
        $or: [
          { phoneNormalized: result.mobileNormalized },
          { phone: result.mobileNormalized },
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

    const phoneVerificationToken = issuePhoneVerificationToken(
      result.mobileNormalized,
    );

    return res.json({
      message: "Mobile number verified successfully.",
      phoneVerificationToken,
      expiresIn: DEFAULT_TTL,
    });
  } catch (err) {
    console.error("verifySignupOtp:", err);
    return res.status(500).json({ message: "Could not verify phone" });
  }
};

exports.assertPhoneVerificationToken = assertPhoneVerificationToken;
exports._internal = { maskPhone };
