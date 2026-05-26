/**
 * Shared mobile-number OTP utility.
 *
 * Used by every flow that needs to verify ownership of a phone number via SMS
 * — school registration, public user signup, etc. Centralizes generation,
 * storage, attempt-counting, throttling and SMS dispatch so the caller only
 * supplies policy (TTL, resend rules, SMS copy) and decides what happens
 * after verification succeeds (e.g. issuing a JWT).
 */
const MobileOtp = require("../models/MobileOtp");
const { normalizePhone } = require("./phone");
const { sendSms } = require("./smsService");

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function maskPhone(p) {
  if (!p || p.length < 4) return "******";
  return `******${p.slice(-4)}`;
}

/**
 * Normalize a phone to its last 10 digits. Returns "" if invalid.
 */
function normalize10(phone) {
  const digits = normalizePhone(phone || "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

/**
 * Generate a new OTP, persist it, send it via SMS, and return the metadata
 * the caller needs to respond to the client.
 *
 * @param {Object} opts
 * @param {string} opts.phone            Raw phone string from the client.
 * @param {string} opts.purpose          One of MobileOtp.PURPOSES.
 * @param {number} [opts.ttlMs]          OTP lifetime in ms. Default 5 minutes.
 * @param {(code: string, masked: string) => string} [opts.smsTemplate]
 *                                       Builder for the SMS body.
 * @param {Object} [opts.resend]         Resend throttle config.
 * @param {number} opts.resend.windowMs  Window over which to count sends.
 * @param {number} opts.resend.max       Max sends allowed in that window.
 *
 * @returns {Promise<
 *   | { ok: true, code: string, mobileNormalized: string, maskedMobile: string, expiresAt: Date }
 *   | { ok: false, status: number, message: string }
 * >}
 */
async function createAndSendOtp({
  phone,
  purpose,
  ttlMs = DEFAULT_TTL_MS,
  smsTemplate = (code) =>
    `UtthanAI OTP: ${code}. Valid for ${Math.round(ttlMs / 60000)} minutes. Do not share.`,
  resend,
}) {
  if (!phone) {
    return {
      ok: false,
      status: 400,
      message: "Mobile number is required",
    };
  }
  if (!purpose || !MobileOtp.PURPOSES.includes(purpose)) {
    return {
      ok: false,
      status: 500,
      message: "Internal: invalid OTP purpose",
    };
  }

  const mobileNormalized = normalize10(phone);
  if (!mobileNormalized) {
    return {
      ok: false,
      status: 400,
      message: "Enter a valid 10-digit mobile number",
    };
  }

  if (resend && resend.windowMs > 0 && resend.max > 0) {
    const since = new Date(Date.now() - resend.windowMs);
    const recentCount = await MobileOtp.countDocuments({
      mobileNormalized,
      purpose,
      createdAt: { $gte: since },
    });
    if (recentCount >= resend.max) {
      return {
        ok: false,
        status: 429,
        message:
          "Too many OTP requests for this number. Please try again later.",
      };
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + ttlMs);

  await MobileOtp.deleteMany({ mobileNormalized, purpose });
  await MobileOtp.create({
    mobileNormalized,
    purpose,
    code,
    expiresAt,
    attempts: 0,
  });

  const masked = maskPhone(mobileNormalized);
  const body = smsTemplate(code, masked);

  // Fire-and-forget; failures are logged but don't break the caller because
  // dev environments commonly run without an SMS gateway configured.
  sendSms(mobileNormalized, body).catch((err) =>
    console.error(`OTP SMS send error (${purpose}):`, err?.message || err),
  );

  if (!process.env.FAST2SMS_API_KEY) {
    console.warn(
      `[mobileOtp:${purpose}] FAST2SMS_API_KEY not set — SMS not sent. Stored OTP for ${masked} (local/dev only).`,
    );
  }

  return { ok: true, code, mobileNormalized, maskedMobile: masked, expiresAt };
}

/**
 * Validate and burn an OTP. On success, all OTPs for that phone+purpose are
 * removed so the code cannot be reused.
 *
 * @param {Object} opts
 * @param {string} opts.phone
 * @param {string} opts.otp
 * @param {string} opts.purpose
 * @param {number} [opts.maxAttempts]
 *
 * @returns {Promise<
 *   | { ok: true, mobileNormalized: string }
 *   | { ok: false, status: number, message: string }
 * >}
 */
async function consumeOtp({
  phone,
  otp,
  purpose,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  if (!phone || !otp) {
    return {
      ok: false,
      status: 400,
      message: "Mobile number and OTP are required",
    };
  }

  const otpStr = String(otp).trim();
  if (!/^[0-9]{6}$/.test(otpStr)) {
    return {
      ok: false,
      status: 400,
      message: "Enter the 6-digit code from your SMS",
    };
  }

  const mobileNormalized = normalize10(phone);
  if (!mobileNormalized) {
    return {
      ok: false,
      status: 400,
      message: "Enter a valid 10-digit mobile number",
    };
  }

  const record = await MobileOtp.findOne({
    mobileNormalized,
    purpose,
  }).sort({ createdAt: -1 });

  if (!record || record.expiresAt < new Date()) {
    return {
      ok: false,
      status: 400,
      message: "OTP expired or not found. Request a new code.",
    };
  }

  if ((record.attempts || 0) >= maxAttempts) {
    await MobileOtp.deleteOne({ _id: record._id });
    return {
      ok: false,
      status: 400,
      message: "Too many incorrect attempts. Request a new OTP.",
    };
  }

  if (record.code !== otpStr) {
    await MobileOtp.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } },
    );
    const remaining = maxAttempts - ((record.attempts || 0) + 1);
    return {
      ok: false,
      status: 400,
      message:
        remaining > 0
          ? `Invalid OTP. ${remaining} attempt(s) left.`
          : "Invalid OTP. Request a new code.",
    };
  }

  await MobileOtp.deleteMany({ mobileNormalized, purpose });
  return { ok: true, mobileNormalized };
}

module.exports = {
  createAndSendOtp,
  consumeOtp,
  normalize10,
  maskPhone,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ATTEMPTS,
};
