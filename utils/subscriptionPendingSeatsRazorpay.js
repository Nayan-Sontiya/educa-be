const mongoose = require("mongoose");
const Student = require("../models/Student");
const SchoolSubscription = require("../models/SchoolSubscription");
const {
  countIncludedSeatStudents,
  countPendingSeatStudents,
} = require("./studentSeatBilling");
const {
  getRazorpay,
  fetchSubscription,
  updateSubscriptionQuantity,
} = require("./razorpayService");

function getRazorpayClient() {
  return getRazorpay();
}

/**
 * After proration payment: move pending_purchase students to included and sync seat cap.
 */
async function finalizePendingSeatActivationForSchool(schoolIdRaw) {
  const schoolId =
    typeof schoolIdRaw === "string"
      ? new mongoose.Types.ObjectId(schoolIdRaw)
      : schoolIdRaw;
  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc?.pendingSeatActivation?.targetBilledStudentCount) {
    return false;
  }
  const target = subDoc.pendingSeatActivation.targetBilledStudentCount;

  await Student.updateMany(
    { schoolId, status: "active", seatBillingStatus: "pending_purchase" },
    { $set: { seatBillingStatus: "included" } }
  );
  subDoc.billedStudentCount = target;
  subDoc.pendingSeatActivation = undefined;
  const rzpSub = await fetchSubscription(subDoc.razorpaySubscriptionId);
  if (rzpSub?.current_start) {
    subDoc.currentPeriodStart = new Date(rzpSub.current_start * 1000);
  }
  if (rzpSub?.current_end) {
    subDoc.currentPeriodEnd = new Date(rzpSub.current_end * 1000);
  }
  await subDoc.save();
  return true;
}

/**
 * Raises Razorpay subscription quantity to (included + pending) on the existing subscription.
 */
async function appendPendingSeatsProratedToCurrentPlan(schoolIdRaw) {
  const schoolId =
    typeof schoolIdRaw === "string"
      ? new mongoose.Types.ObjectId(schoolIdRaw)
      : schoolIdRaw;

  const rzp = getRazorpayClient();
  if (!rzp) {
    return { ok: false, reason: "razorpay_not_configured" };
  }

  const sub = await SchoolSubscription.findOne({ schoolId });
  if (!sub?.razorpaySubscriptionId || sub.status !== "active" || sub.billingMode !== "per_seat") {
    return { ok: false, reason: "subscription_not_eligible" };
  }

  const pendingCount = await countPendingSeatStudents(schoolId);
  if (pendingCount < 1) {
    return { ok: false, reason: "no_pending_seats" };
  }

  const included = await countIncludedSeatStudents(schoolId);
  const newQty = included + pendingCount;

  const rzpSub = await fetchSubscription(sub.razorpaySubscriptionId);
  const currentQty = Number(rzpSub?.quantity) || sub.billedStudentCount || 0;
  if (currentQty >= newQty) {
    return { ok: true, kind: "noop", newQty, currentQty };
  }

  const previousBilled = Number(sub.billedStudentCount) || 0;

  await SchoolSubscription.updateOne(
    { schoolId },
    {
      $set: {
        pendingSeatActivation: {
          provisional: true,
          targetBilledStudentCount: newQty,
          previousBilledStudentCount: previousBilled,
        },
      },
    }
  );

  try {
    await updateSubscriptionQuantity(sub.razorpaySubscriptionId, newQty);
    await finalizePendingSeatActivationForSchool(String(schoolId));
    const refreshed = await SchoolSubscription.findOne({ schoolId });
    return {
      ok: true,
      kind: "paid",
      pendingCount,
      billedStudentCount: refreshed?.billedStudentCount ?? newQty,
      currentPeriodEnd: refreshed?.currentPeriodEnd,
    };
  } catch (err) {
    await SchoolSubscription.updateOne({ schoolId }, { $unset: { pendingSeatActivation: 1 } });
    throw err;
  }
}

module.exports = {
  getRazorpayClient,
  finalizePendingSeatActivationForSchool,
  appendPendingSeatsProratedToCurrentPlan,
};
