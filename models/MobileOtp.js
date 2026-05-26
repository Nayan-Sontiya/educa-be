const mongoose = require("mongoose");

/**
 * Generic, short-lived OTP for any "verify a mobile number" flow.
 *
 * Replaces the previous per-flow models (SchoolRegistrationOtp, SignupOtp).
 * Discriminate by `purpose` so multiple flows can share the same collection
 * without colliding (a user might legitimately have one school-registration
 * OTP and one user-signup OTP active at the same time, for example).
 *
 * MongoDB's TTL index removes expired rows automatically.
 */
const MOBILE_OTP_PURPOSES = ["school_registration", "signup_phone"];

const mobileOtpSchema = new mongoose.Schema(
  {
    mobileNormalized: { type: String, required: true },
    code: { type: String, required: true },
    purpose: {
      type: String,
      enum: MOBILE_OTP_PURPOSES,
      required: true,
    },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

mobileOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
mobileOtpSchema.index({ mobileNormalized: 1, purpose: 1 });

const MobileOtp = mongoose.model("MobileOtp", mobileOtpSchema);
MobileOtp.PURPOSES = MOBILE_OTP_PURPOSES;

module.exports = MobileOtp;
