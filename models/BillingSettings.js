const mongoose = require("mongoose");

/** Singleton platform billing config (editable by platform admin). */
const billingSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "global" },
    pricePerStudentYearInr: { type: Number, default: 300, min: 1 },
    gracePeriodDays: { type: Number, default: 3, min: 0 },
    /** Days before period end to send reminders (default 3,2,1) */
    reminderOffsetsDays: { type: [Number], default: [3, 2, 1] },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.BillingSettings || mongoose.model("BillingSettings", billingSettingsSchema);
