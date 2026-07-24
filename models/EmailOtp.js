const mongoose = require("mongoose");

/**
 * Generic, short-lived OTP for email verification signup flow.
 */
const EMAIL_OTP_PURPOSES = ["signup_email"];

const emailOtpSchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, required: true },
    code: { type: String, required: true },
    purpose: {
      type: String,
      enum: EMAIL_OTP_PURPOSES,
      required: true,
    },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
emailOtpSchema.index({ emailNormalized: 1, purpose: 1 });

const EmailOtp = mongoose.model("EmailOtp", emailOtpSchema);
EmailOtp.PURPOSES = EMAIL_OTP_PURPOSES;

module.exports = EmailOtp;
