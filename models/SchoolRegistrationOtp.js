const mongoose = require("mongoose");

/**
 * Short-lived OTP for public school registration (mobile verification).
 * MongoDB TTL removes expired rows automatically.
 */
const schoolRegistrationOtpSchema = new mongoose.Schema(
  {
    mobileNormalized: { type: String, required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schoolRegistrationOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schoolRegistrationOtpSchema.index({ mobileNormalized: 1 });

module.exports = mongoose.model("SchoolRegistrationOtp", schoolRegistrationOtpSchema);
