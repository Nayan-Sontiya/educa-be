const mongoose = require("mongoose");

const PLAN_ENUM = ["monthly", "quarterly", "yearly", "custom"];
const STATUS_ENUM = [
  "incomplete", // checkout not finished
  "active",
  "past_due", // Stripe past_due or unpaid invoice
  "grace", // local grace after failed renewal
  "suspended", // API access blocked
  "canceled",
];

const schoolSubscriptionSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      unique: true,
      index: true,
    },
    plan: { type: String, enum: PLAN_ENUM },
    /**
     * per_seat: Stripe catalog price × active student quantity (see subscription catalog).
     * dynamic_total: legacy — single line item, amount computed in app (quantity 1).
     */
    billingMode: { type: String, enum: ["per_seat", "dynamic_total"] },
    /** Active students at last successful invoice / checkout */
    billedStudentCount: { type: Number, default: 0, min: 0 },
    pricePerStudentYearInr: { type: Number, default: 300 },
    status: { type: String, enum: STATUS_ENUM, default: "incomplete" },
    stripeCustomerId: { type: String, trim: true },
    stripeSubscriptionId: { type: String, trim: true },
    stripePriceId: { type: String, trim: true },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    /** When grace started (payment failed) */
    graceStartedAt: Date,
    graceEndsAt: Date,
    lastPaymentAt: Date,
    canceledAt: Date,
    remindersSent: {
      preDue3: { type: Boolean, default: false },
      preDue2: { type: Boolean, default: false },
      preDue1: { type: Boolean, default: false },
    },
    /** Last calendar day we sent a grace reminder */
    graceReminderDay: { type: String, trim: true },
    /** Platform admin manual access window */
    adminUnblockUntil: Date,
    adminNote: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SchoolSubscription ||
  mongoose.model("SchoolSubscription", schoolSubscriptionSchema);
