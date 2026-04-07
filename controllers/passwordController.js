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

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_RESEND = 3;

const GENERIC_SEND_OTP = {
  message: "If this username is registered, an OTP has been sent.",
};

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

/** POST /api/auth/forgot-password/send-otp */
exports.forgotPasswordSendOtp = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || String(username).trim().length < 3) {
      return res.status(400).json({ message: "Please enter a valid username" });
    }

    const user = await findUserByUsername(username);
    const pn = user ? normalizePhone(user.phone) : "";
    if (!user || !pn) {
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

    user.authOtp = {
      code: generateCode(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 3,
      resendCount,
      purpose: "forgot",
    };
    await user.save();

    const body = { ...GENERIC_SEND_OTP };
    body.maskedMobile = maskPhone(user.phone);
    body.message = `OTP sent to ${body.maskedMobile}`;
    if (process.env.NODE_ENV !== "production") {
      body.code = user.authOtp?.code;
      body.message = "OTP sent (dev). Use code to verify.";
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
    const { username, otp } = req.body;
    if (!username || !otp) {
      return res.status(400).json({ message: "Username and OTP are required" });
    }
    if (!/^[0-9]{6}$/.test(String(otp).trim())) {
      return res.status(400).json({ message: "OTP must be 6 digits" });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired OTP" });
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

    res.json({
      message: "OTP verified",
      resetToken,
    });
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

const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/auth/change-password
 * Without otp: validates current + new, stores pending hash, sends OTP.
 * With otp: verifies OTP and applies pending password.
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

    const { currentPassword, newPassword, confirmPassword, otp } = req.body;

    if (otp !== undefined && otp !== null && String(otp).trim() !== "") {
      const pending = user.pendingPasswordChange;
      if (
        !pending?.newPasswordHash ||
        !pending.expiresAt ||
        new Date() > new Date(pending.expiresAt)
      ) {
        return res.status(400).json({
          message:
            "Session expired. Enter your current and new password again to request a new OTP.",
        });
      }

      const result = await verifyOtpOnUser(user, otp, "change");
      if (!result.ok) {
        return res.status(400).json({ message: result.message });
      }

      clearOtp(user);
      user.password = pending.newPasswordHash;
      user.pendingPasswordChange = undefined;
      await user.save();

      return res.json({ message: "Password changed successfully" });
    }

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

    const phoneDigits = normalizePhone(user.phone);
    if (!phoneDigits) {
      return res.status(400).json({
        message:
          "No mobile number on your account. Add a phone in your profile or contact support.",
      });
    }

    user.pendingPasswordChange = {
      newPasswordHash: await bcrypt.hash(newPassword, 10),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    };
    await user.save();
    await assignOtpToUser(user, "change");

    const body = {
      message: "OTP sent to your registered mobile. Submit the code to confirm.",
      step: "otp",
    };
    if (process.env.NODE_ENV !== "production") {
      body.code = user.authOtp?.code;
    }
    res.json(body);
  } catch (e) {
    console.error("changePassword:", e);
    res.status(500).json({ message: "Could not change password" });
  }
};
