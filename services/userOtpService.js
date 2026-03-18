/**
 * User auth OTP — same generation pattern as school sendOtp (6-digit, dev returns code).
 * Stored on User.authOtp with expiry and attempt limit.
 */
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function assignOtpToUser(userDoc, purpose) {
  const code = generateCode();
  userDoc.authOtp = {
    code,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: MAX_ATTEMPTS,
    purpose,
  };
  await userDoc.save();
  return code;
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
async function verifyOtpOnUser(userDoc, otp, expectedPurpose) {
  const block = userDoc.authOtp;
  if (!block || !block.code || block.purpose !== expectedPurpose) {
    return { ok: false, message: "No active OTP. Request a new code." };
  }
  if (new Date() > new Date(block.expiresAt)) {
    userDoc.authOtp = undefined;
    await userDoc.save();
    return { ok: false, message: "OTP expired. Request a new code." };
  }
  if ((block.attempts || 0) <= 0) {
    userDoc.authOtp = undefined;
    await userDoc.save();
    return { ok: false, message: "Too many attempts. Request a new OTP." };
  }
  if (String(otp).trim() !== String(block.code)) {
    block.attempts = (block.attempts || 1) - 1;
    await userDoc.save();
    return {
      ok: false,
      message: `Invalid OTP. ${block.attempts} attempt(s) left.`,
    };
  }
  return { ok: true };
}

function clearOtp(userDoc) {
  userDoc.authOtp = undefined;
}

module.exports = {
  assignOtpToUser,
  verifyOtpOnUser,
  clearOtp,
  OTP_TTL_MS,
  MAX_ATTEMPTS,
};
