const mongoose = require("mongoose");

const PLAN_ENUM = ["monthly", "quarterly", "yearly", "custom"];
const STATUS_ENUM = [
  "trialing", // school approval trial window (4 weeks)
  "active", // paid subscription in good standing
  "inactive", // payment required / no valid subscription after trial
  "pending", // Razorpay subscription created, awaiting first payment
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
     * per_seat: Razorpay plan unit amount × included student quantity.
     * dynamic_total: legacy — single line item, amount computed in app (quantity 1).
     */
    billingMode: { type: String, enum: ["per_seat", "dynamic_total"] },
    /** Active students at last successful charge / checkout */
    billedStudentCount: { type: Number, default: 0, min: 0 },
    pricePerStudentYearInr: { type: Number, default: 300 },
    status: { type: String, enum: STATUS_ENUM, default: "inactive" },
    razorpayCustomerId: { type: String, trim: true },
    razorpaySubscriptionId: { type: String, trim: true },
    /** Latest one-time checkout order (school plan); not a recurring mandate. */
    razorpayOrderId: { type: String, trim: true },
    razorpayPaymentId: { type: String, trim: true },
    razorpayPlanId: { type: String, trim: true },
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
    pendingSeatActivation: {
      provisional: Boolean,
      targetBilledStudentCount: Number,
      previousBilledStudentCount: Number,
      invoiceId: String,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SchoolSubscription ||
  mongoose.model("SchoolSubscription", schoolSubscriptionSchema);
