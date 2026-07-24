/**
 * Signup phone verification via Firebase Phone Auth (client sends SMS; server verifies ID token).
 *
 * Endpoints:
 *   POST /api/auth/signup/send-otp     — phone format check (no SMS from backend)
 *   POST /api/auth/signup/verify-otp   — body: { phone, firebaseIdToken }
 */
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

/** POST /api/auth/signup/send-otp — validate phone; client sends OTP via Firebase */
exports.sendSignupOtp = async (req, res) => {
  try {
    const { phone } = req.body || {};
    const mobileNormalized = normalize10(phone || "");

    if (!mobileNormalized) {
      return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
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

/** POST /api/auth/signup/send-email-otp — validate email & send OTP */
exports.sendSignupEmailOtp = async (req, res) => {
  try {
    const EmailOtp = require("../models/EmailOtp");
    const { sendMail } = require("../utils/mail");
    const { assertEmailAvailable, isValidEmailFormat } = require("../utils/emailUniqueness");

    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!isValidEmailFormat(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    const emailCheck = await assertEmailAvailable(email);
    if (!emailCheck.ok) {
      return res.status(409).json({ success: false, message: "An account already exists with this email address." });
    }

    const emailNormalized = emailCheck.normalizedEmail;
    // Generate 6-digit numeric OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Delete any existing OTP for this email
    await EmailOtp.deleteMany({ emailNormalized, purpose: "signup_email" });

    await EmailOtp.create({
      emailNormalized,
      code,
      purpose: "signup_email",
      expiresAt,
    });

    await sendMail({
      to: emailNormalized,
      subject: "Verify your email address — UtthanAI",
      text: `Your UtthanAI email verification OTP is: ${code}\n\nValid for 15 minutes. Do not share this code.`,
      html: `<p>Your UtthanAI email verification OTP is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Valid for 15 minutes.</p>`,
      logContext: "signup_email_otp",
    });

    return res.json({
      success: true,
      message: "OTP sent to your email address.",
    });
  } catch (err) {
    console.error("sendSignupEmailOtp error:", err);
    return res.status(500).json({ success: false, message: "Could not send OTP." });
  }
};

/** POST /api/auth/signup/verify-email-otp — verify email OTP and issue verification token */
exports.verifySignupEmailOtp = async (req, res) => {
  try {
    const EmailOtp = require("../models/EmailOtp");
    const { assertEmailAvailable } = require("../utils/emailUniqueness");
    const { issueEmailVerificationToken } = require("../utils/emailVerificationJwt");

    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ success: false, message: "Email and code are required." });
    }

    const emailCheck = await assertEmailAvailable(email);
    if (!emailCheck.ok) {
      return res.status(409).json({ success: false, message: "An account already exists with this email address." });
    }

    const emailNormalized = emailCheck.normalizedEmail;
    const otpDoc = await EmailOtp.findOne({
      emailNormalized,
      code: String(code).trim(),
      purpose: "signup_email",
      expiresAt: { $gt: new Date() },
    });

    if (!otpDoc) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP." });
    }

    // Delete used OTP doc
    await EmailOtp.deleteOne({ _id: otpDoc._id });

    // Issue JWT token for email verification
    const emailVerificationToken = issueEmailVerificationToken(emailNormalized);

    return res.json({
      success: true,
      message: "Email address verified successfully.",
      emailVerificationToken,
    });
  } catch (err) {
    console.error("verifySignupEmailOtp error:", err);
    return res.status(500).json({ success: false, message: "Could not verify OTP." });
  }
};

exports.assertPhoneVerificationToken = assertPhoneVerificationToken;
exports._internal = { maskPhone };
