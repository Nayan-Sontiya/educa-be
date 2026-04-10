const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { normalizePhone } = require("../utils/phone");
const { normalizeUsername } = require("../utils/username");
const {
  assignOtpToUser,
  verifyOtpOnUser,
  clearOtp,
} = require("../services/userOtpService");
const { sendSms } = require("../utils/smsService");
const { sendMail } = require("../utils/mail");

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_RESEND = 3;

const GENERIC_SEND_OTP = {
  message: "If this account is registered, an OTP has been sent.",
};

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function maskPhone(phone) {
  const n = normalizePhone(phone || "");
  if (!n || n.length < 4) return "******";
  return `******${n.slice(-4)}`;
}

function validatePasswordStrength(pw) {
  if (!pw || typeof pw !== "string")
    return "Password is required";
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must include a number";
  return null;
}

async function findUserByMobile(mobile) {
  const n = normalizePhone(mobile);
  if (!n || n.length < 8) return null;

  let user = await User.findOne({ phoneNormalized: n });
  if (user) return user;

  const tail10 = n.length >= 10 ? n.slice(-10) : n;
  user = await User.findOne({ phoneNormalized: tail10 });
  if (user) return user;

  const ors = [
    { phone: n },
    { phone: tail10 },
    { phone: `+91${tail10}` },
    { phone: `91${tail10}` },
    { phone: `0${tail10}` },
  ];
  const candidates = await User.find({ $or: ors });
  for (const u of candidates) {
    const pn = normalizePhone(u.phone);
    if (!pn) continue;
    if (pn === n || pn.endsWith(tail10) || n.endsWith(pn.slice(-10))) {
      if (!u.phoneNormalized) {
        u.phoneNormalized = pn;
        await u.save().catch(() => {});
      }
      return u;
    }
  }
  return null;
}

async function findUserByUsername(username) {
  const uname = normalizeUsername(username);
  if (!uname) return null;
  return User.findOne({ username: uname });
}

async function findUserByEmail(email) {
  if (!email) return null;
  return User.findOne({ email: email.trim().toLowerCase() });
}

/**
 * Resolve user from an identifier that is either an email address or a username.
 * Returns { user, via } where via is 'email' or 'sms'.
 */
async function resolveUserFromIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return { user: null, via: null };

  if (isEmail(raw)) {
    const user = await findUserByEmail(raw);
    return { user, via: "email" };
  }

  const user = await findUserByUsername(raw);
  return { user, via: "sms" };
}

/** POST /api/auth/forgot-password/send-otp */
exports.forgotPasswordSendOtp = async (req, res) => {
  try {
    // Accept `identifier` (new) or fall back to legacy `username` field
    const identifier = req.body.identifier || req.body.username;
    if (!identifier || String(identifier).trim().length < 3) {
      return res.status(400).json({ message: "Please enter a valid email or username" });
    }

    const { user, via } = await resolveUserFromIdentifier(identifier);

    // For email flow, user must have an email. For SMS flow, user must have a phone.
    const pn = user ? normalizePhone(user.phone) : "";
    const hasDeliveryChannel = via === "email" ? !!user?.email : !!pn;

    if (!user || !hasDeliveryChannel) {
      return res.json(GENERIC_SEND_OTP);
    }

    const existing = user.authOtp;
    const now = new Date();
    const stillValidForgot =
      existing &&
      existing.purpose === "forgot" &&
      existing.expiresAt &&
      now <= new Date(existing.expiresAt);

    const resendCount = stillValidForgot ? Number(existing.resendCount || 0) + 1 : 1;
    if (resendCount > MAX_RESEND) {
      return res.status(429).json({
        message: "Maximum resend attempts reached. Please try again after OTP expiry.",
      });
    }

    const code = generateCode();
    user.authOtp = {
      code,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 3,
      resendCount,
      purpose: "forgot",
    };
    await user.save();

    const body = { ...GENERIC_SEND_OTP };

    if (via === "email") {
      const maskedEmail = user.email.replace(/(.{2}).+(@.+)/, "$1***$2");
      body.maskedEmail = maskedEmail;
      body.message = `OTP sent to ${maskedEmail}`;

      sendMail({
        to: user.email,
        subject: "UtthanAI — Password reset OTP",
        text:
          `Your OTP to reset your UtthanAI password is: ${code}\n\n` +
          `This code expires in 5 minutes. Do not share it with anyone.`,
        html:
          `<p>Your OTP to reset your <strong>UtthanAI</strong> password is:</p>` +
          `<h2 style="letter-spacing:6px;font-family:monospace;">${code}</h2>` +
          `<p style="color:#888;font-size:13px;">This code expires in 5 minutes. Do not share it with anyone.</p>`,
        logContext: "forgot_password_otp",
      }).catch((err) => console.error("forgot OTP email send error:", err.message));
    } else {
      body.maskedMobile = maskPhone(user.phone);
      body.message = `OTP sent to ${body.maskedMobile}`;

      const smsText = `UtthanAI OTP: ${code}. Valid 5 mins. Do not share.`;
      sendSms(pn, smsText).catch((err) =>
        console.error("forgot OTP SMS send error:", err.message)
      );
    }

    // In dev, expose OTP in response only for SMS (phone may not be reachable).
    // For email, the real email is sent — no need to leak the code.
    if (process.env.NODE_ENV !== "production" && via === "sms") {
      body.code = code;
      body.message = "OTP sent (dev SMS). Use code to verify.";
    }

    res.json(body);
  } catch (e) {
    console.error("forgotPasswordSendOtp:", e);
    res.status(500).json({ message: "Could not send OTP" });
  }
};

/** POST /api/auth/forgot-password/verify-otp */
exports.forgotPasswordVerifyOtp = async (req, res) => {
  try {
    // Accept `identifier` (new) or fall back to legacy `username`
    const identifier = req.body.identifier || req.body.username;
    const { otp } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ message: "Identifier and OTP are required" });
    }
    if (!/^[0-9]{6}$/.test(String(otp).trim())) {
      return res.status(400).json({ message: "OTP must be 6 digits" });
    }

    const { user } = await resolveUserFromIdentifier(identifier);
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const result = await verifyOtpOnUser(user, otp, "forgot");
    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    clearOtp(user);
    await user.save();

    const resetToken = jwt.sign(
      { uid: user._id.toString(), typ: "pwd_reset" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    res.json({ message: "OTP verified", resetToken });
  } catch (e) {
    console.error("forgotPasswordVerifyOtp:", e);
    res.status(500).json({ message: "Verification failed" });
  }
};

/** POST /api/auth/forgot-password/reset */
exports.forgotPasswordReset = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;
    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const strength = validatePasswordStrength(newPassword);
    if (strength) {
      return res.status(400).json({ message: strength });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        message: "Reset link expired. Start forgot password again.",
      });
    }

    if (decoded.typ !== "pwd_reset" || !decoded.uid) {
      return res.status(400).json({ message: "Invalid reset token" });
    }

    const user = await User.findById(decoded.uid);
    if (!user) {
      return res.status(400).json({ message: "Invalid reset token" });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      return res
        .status(400)
        .json({ message: "Choose a password you have not used before" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({
      message: "Password reset successful. Please login.",
    });
  } catch (e) {
    console.error("forgotPasswordReset:", e);
    res.status(500).json({ message: "Could not reset password" });
  }
};

/**
 * POST /api/auth/change-password
 * Authenticated users: verify current password, then set new password (no OTP).
 */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message:
          "Current password, new password, and confirmation are required",
      });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const strength = validatePasswordStrength(newPassword);
    if (strength) {
      return res.status(400).json({ message: strength });
    }

    const same = await bcrypt.compare(newPassword, user.password);
    if (same) {
      return res
        .status(400)
        .json({ message: "New password must be different from your current password" });
    }

    clearOtp(user);
    user.password = await bcrypt.hash(newPassword, 10);
    user.pendingPasswordChange = undefined;
    await user.save();

    return res.json({ message: "Password changed successfully" });
  } catch (e) {
    console.error("changePassword:", e);
    res.status(500).json({ message: "Could not change password" });
  }
};
