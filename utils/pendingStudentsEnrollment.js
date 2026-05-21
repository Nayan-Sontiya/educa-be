const mongoose = require("mongoose");
const Student = require("../models/Student");
const SchoolSubscription = require("../models/SchoolSubscription");
const BillingSettings = require("../models/BillingSettings");
const { planAmountPaise } = require("./subscriptionPricing");
const { fetchSubscription, fetchRazorpayPlan } = require("./razorpayService");
const { countIncludedSeatStudents } = require("./studentSeatBilling");

/**
 * Paid subscription in good standing with a non-expired billing period.
 * Maps to product requirement "school.status === ACTIVE" (subscription active, plan not expired).
 */
async function isSchoolSubscriptionActivePaid(schoolId) {
  if (!schoolId) return false;
  const sid =
    typeof schoolId === "string"
      ? schoolId
      : schoolId._id
        ? String(schoolId._id)
        : String(schoolId);
  const sub = await SchoolSubscription.findOne({ schoolId: sid }).lean();
  if (!sub || sub.status !== "active") return false;
  if (!sub.currentPeriodEnd) return false;
  return new Date(sub.currentPeriodEnd).getTime() > Date.now();
}

async function getPricePerStudentYearInr() {
  let b = await BillingSettings.findById("global").lean();
  if (!b) {
    b = await BillingSettings.create({
      _id: "global",
      pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
    });
  }
  return Number(b.pricePerStudentYearInr) || 300;
}

/**
 * Prorated INR for pending students for the rest of the **current billing period**.
 *
 * Uses `SchoolSubscription.plan` (monthly | quarterly | yearly) and global
 * `pricePerStudentYearInr` the same way as `/subscription/status` (via planAmountPaise).
 * One seat’s full-period charge = yearly-equivalent ÷ 12, ÷ 4, or full year; then multiply by
 * (remaining time in period) / (period length).
 *
 * For `custom` or missing period bounds, falls back to ₹/day = yearly ÷ 365 until period end.
 *
 * @param {object|null|undefined} subscriptionLike — { plan, currentPeriodStart, currentPeriodEnd }
 */
function calculatePendingStudentsAmount(pendingCount, subscriptionLike, pricePerStudentYearInr) {
  if (!pendingCount || pendingCount < 1) return 0;

  const now = new Date();
  const periodEnd = subscriptionLike?.currentPeriodEnd
    ? new Date(subscriptionLike.currentPeriodEnd)
    : null;
  if (!periodEnd || Number.isNaN(periodEnd.getTime()) || periodEnd <= now) return 0;

  const plan = subscriptionLike?.plan;
  const periodStart = subscriptionLike?.currentPeriodStart
    ? new Date(subscriptionLike.currentPeriodStart)
    : null;

  const priceYear = Number(pricePerStudentYearInr) || 300;

  if (
    plan &&
    ["monthly", "quarterly", "yearly"].includes(plan) &&
    periodStart &&
    !Number.isNaN(periodStart.getTime()) &&
    periodEnd > periodStart
  ) {
    const fullPeriodOneSeatInr = planAmountPaise(plan, 1, priceYear) / 100;
    const periodMs = periodEnd.getTime() - periodStart.getTime();
    const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
    const fraction = Math.min(1, Math.max(0, remainingMs / periodMs));
    return Math.round(pendingCount * fullPeriodOneSeatInr * fraction);
  }

  const remainingDays =
    Math.max(0, periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const perDayCost = priceYear / 365;
  return Math.round(pendingCount * perDayCost * remainingDays);
}

/**
 * Preferred: prorate using the **live Razorpay subscription** (plan amount × quantity).
 *
 * Falls back to `calculatePendingStudentsAmount` if Razorpay is unavailable or retrieval fails.
 *
 * @returns {{ amountInr: number, source: 'razorpay' | 'catalog_fallback' | 'none' }}
 */
async function resolvePendingStudentsAmountInr(
  schoolId,
  pendingCount,
  subscriptionLike,
  pricePerStudentYearInr
) {
  if (!pendingCount || pendingCount < 1) {
    return { amountInr: 0, source: "none" };
  }

  const subId = subscriptionLike?.razorpaySubscriptionId;
  if (subId) {
    try {
      const rzpSub = await fetchSubscription(subId);
      const plan = rzpSub?.plan_id ? await fetchRazorpayPlan(rzpSub.plan_id) : null;
      const unitMinor = plan?.item?.amount != null ? Number(plan.item.amount) : null;
      if (unitMinor != null && unitMinor >= 1) {
        const periodStart = rzpSub.current_start
          ? new Date(rzpSub.current_start * 1000)
          : subscriptionLike?.currentPeriodStart
            ? new Date(subscriptionLike.currentPeriodStart)
            : null;
        const periodEnd = rzpSub.current_end
          ? new Date(rzpSub.current_end * 1000)
          : subscriptionLike?.currentPeriodEnd
            ? new Date(subscriptionLike.currentPeriodEnd)
            : null;
        const now = new Date();
        if (periodEnd && periodEnd > now && periodStart) {
          const periodMs = periodEnd.getTime() - periodStart.getTime();
          const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
          const fraction =
            periodMs > 0 ? Math.min(1, Math.max(0, remainingMs / periodMs)) : 0;

          const qty = Number(rzpSub.quantity) || 1;
          const mode = subscriptionLike.billingMode;

          let fullPeriodOneSeatInr;
          if (mode === "per_seat") {
            fullPeriodOneSeatInr = unitMinor / 100;
          } else if (mode === "dynamic_total") {
            const seats = Math.max(1, await countIncludedSeatStudents(schoolId));
            fullPeriodOneSeatInr = (unitMinor * qty) / 100 / seats;
          } else {
            fullPeriodOneSeatInr =
              qty > 1
                ? unitMinor / 100
                : (unitMinor / 100) / Math.max(1, await countIncludedSeatStudents(schoolId));
          }

          return {
            amountInr: Math.round(pendingCount * fullPeriodOneSeatInr * fraction),
            source: "razorpay",
          };
        }
      }
    } catch (e) {
      console.error("resolvePendingStudentsAmountInr (Razorpay):", e.message || e);
    }
  }

  const amountInr = calculatePendingStudentsAmount(
    pendingCount,
    subscriptionLike,
    pricePerStudentYearInr
  );
  return { amountInr, source: "catalog_fallback" };
}

async function countPendingActivationStudents(schoolId) {
  if (!schoolId) return 0;
  const oid = new mongoose.Types.ObjectId(String(schoolId));
  return Student.countDocuments({
    schoolId: oid,
    status: "pending",
  });
}

module.exports = {
  isSchoolSubscriptionActivePaid,
  getPricePerStudentYearInr,
  calculatePendingStudentsAmount,
  resolvePendingStudentsAmountInr,
  countPendingActivationStudents,
};
