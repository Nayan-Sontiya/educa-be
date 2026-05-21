const mongoose = require("mongoose");

/** Singleton platform billing config (editable by platform admin). */
const billingSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "global" },
    pricePerStudentYearInr: { type: Number, default: 300, min: 1 },
    /** When false, no verified school receives a free trial (subscribe immediately). */
    freeTrialEnabled: { type: Boolean, default: true },
    /** Default free-trial length for new schools (weeks from verifiedAt). 0 = no trial when globally enabled. */
    defaultTrialWeeks: { type: Number, default: 4, min: 0 },
    gracePeriodDays: { type: Number, default: 3, min: 0 },
    /** Days before period end to send reminders (default 3,2,1) */
    reminderOffsetsDays: { type: [Number], default: [3, 2, 1] },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.BillingSettings || mongoose.model("BillingSettings", billingSettingsSchema);
