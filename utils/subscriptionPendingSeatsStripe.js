const mongoose = require("mongoose");
const Stripe = require("stripe");
const Student = require("../models/Student");
const SchoolSubscription = require("../models/SchoolSubscription");
const {
  countIncludedSeatStudents,
  countPendingSeatStudents,
} = require("./studentSeatBilling");

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || typeof key !== "string" || !String(key).trim()) return null;
  return new Stripe(String(key).trim());
}

/**
 * After proration invoice is paid: move pending_purchase students to included and sync seat cap.
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
  const stripe = getStripe();
  if (stripe && subDoc.stripeSubscriptionId) {
    const stripeSub = await stripe.subscriptions.retrieve(subDoc.stripeSubscriptionId);
    subDoc.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
    subDoc.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
  }
  await subDoc.save();
  return true;
}

async function maybeFinalizePendingSeatActivationFromInvoice(stripe, invoice, schoolIdRaw) {
  if (!schoolIdRaw || !invoice?.subscription) return;
  const schoolIdStr = String(schoolIdRaw);
  const subDoc = await SchoolSubscription.findOne({ schoolId: schoolIdStr });
  if (!subDoc?.pendingSeatActivation) return;

  const p = subDoc.pendingSeatActivation;
  const invSub =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;
  if (String(invSub) !== String(subDoc.stripeSubscriptionId)) return;

  const invMatches =
    (p.invoiceId && p.invoiceId === invoice.id) ||
    (p.provisional && invoice.billing_reason === "subscription_update");

  if (!invMatches) return;

  await finalizePendingSeatActivationForSchool(schoolIdStr);
}

/**
 * Raises Stripe subscription per-seat quantity to (included + pending) on the **existing** subscription.
 * Stripe `create_prorations` bills only the **new** seats for the **remaining fraction** of the current
 * billing period (same interval as the plan: month / quarter / year).
 *
 * Students stay `pending_purchase` until the proration invoice is paid; then finalize flips them to included.
 *
 * @param {import("mongoose").Types.ObjectId|string} schoolIdRaw
 * @returns {Promise<
 *   | { ok: false; reason: string }
 *   | { ok: true; kind: "noop" }
 *   | { ok: true; kind: "paid"; pendingCount: number; billedStudentCount: number; currentPeriodEnd?: Date }
 *   | { ok: true; kind: "requires_payment"; pendingCount: number; newQty: number; invoice: import("stripe").Stripe.Invoice }
 * >}
 */
async function appendPendingSeatsProratedToCurrentPlan(schoolIdRaw) {
  const schoolId =
    typeof schoolIdRaw === "string"
      ? new mongoose.Types.ObjectId(schoolIdRaw)
      : schoolIdRaw;

  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, reason: "stripe_not_configured" };
  }

  const sub = await SchoolSubscription.findOne({ schoolId });
  if (!sub?.stripeSubscriptionId || sub.status !== "active" || sub.billingMode !== "per_seat") {
    return { ok: false, reason: "subscription_not_eligible" };
  }

  const pendingCount = await countPendingSeatStudents(schoolId);
  if (pendingCount < 1) {
    return { ok: false, reason: "no_pending_seats" };
  }

  const included = await countIncludedSeatStudents(schoolId);
  const newQty = included + pendingCount;

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });
  const item = stripeSub.items.data[0];
  const itemId = item?.id;
  if (!itemId) {
    return { ok: false, reason: "no_subscription_item" };
  }

  const stripeQty = item.quantity;
  if (stripeQty >= newQty) {
    return { ok: true, kind: "noop", newQty, stripeQty };
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
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, quantity: newQty }],
      proration_behavior: "create_prorations",
    });

    const updatedStripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
      expand: ["latest_invoice.payment_intent"],
    });
    const latestInv = updatedStripeSub.latest_invoice;
    if (!latestInv) {
      await SchoolSubscription.updateOne({ schoolId }, { $unset: { pendingSeatActivation: 1 } });
      return { ok: false, reason: "no_invoice_after_update" };
    }
    const inv =
      typeof latestInv === "string"
        ? await stripe.invoices.retrieve(latestInv, { expand: ["payment_intent"] })
        : latestInv;

    await SchoolSubscription.updateOne(
      { schoolId },
      {
        $set: {
          "pendingSeatActivation.invoiceId": inv.id,
          "pendingSeatActivation.provisional": false,
        },
      }
    );

    if (inv.status === "paid") {
      await finalizePendingSeatActivationForSchool(String(schoolId));
      const refreshed = await SchoolSubscription.findOne({ schoolId });
      return {
        ok: true,
        kind: "paid",
        pendingCount,
        billedStudentCount: refreshed?.billedStudentCount ?? newQty,
        currentPeriodEnd: refreshed?.currentPeriodEnd,
      };
    }

    return {
      ok: true,
      kind: "requires_payment",
      pendingCount,
      newQty,
      invoice: inv,
    };
  } catch (err) {
    await SchoolSubscription.updateOne({ schoolId }, { $unset: { pendingSeatActivation: 1 } });
    throw err;
  }
}

module.exports = {
  getStripe,
  finalizePendingSeatActivationForSchool,
  maybeFinalizePendingSeatActivationFromInvoice,
  appendPendingSeatsProratedToCurrentPlan,
};
