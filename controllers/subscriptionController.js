const mongoose = require("mongoose");
const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");
const BillingSettings = require("../models/BillingSettings");
const Student = require("../models/Student");
const User = require("../models/User");
const {
  isSchoolSubscriptionActivePaid,
  getPricePerStudentYearInr,
  resolvePendingStudentsAmountInr,
  countPendingActivationStudents,
} = require("../utils/pendingStudentsEnrollment");
const { planAmountPaise, periodBoundsForPlan } = require("../utils/subscriptionPricing");
const { getSchoolBillingAccess, trialEndsAtFromSchool } = require("../utils/subscriptionAccess");
const {
  countRosterActiveStudents,
  countIncludedSeatStudents,
} = require("../utils/studentSeatBilling");
const { sendMail } = require("../utils/mail");
const {
  PLAN_KEYS,
  razorpayKeyId,
  isRazorpayConfigured,
  verifyWebhookSignature,
  verifySubscriptionPaymentSignature,
  verifyOrderPaymentSignature,
  loadSubscriptionCatalogPrices,
  ensureRazorpayCustomer,
  createSchoolPlanOrder,
  fetchSubscription,
  resolvePlanId,
  updateSubscriptionQuantity,
  cancelSubscription,
  createPendingStudentsOrder,
  mapRazorpaySubscriptionStatus,
  periodBoundsFromRazorpaySubscription,
  envPlanId,
  syncRazorpayPlansByCadence,
} = require("../utils/razorpayService");

async function getBillingSettingsDoc() {
  let b = await BillingSettings.findById("global");
  if (!b) {
    b = await BillingSettings.create({
      _id: "global",
      pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
    });
  }
  return b;
}

function subscriptionStatusForClient(raw) {
  return raw || "inactive";
}

function webAppBase() {
  return (
    process.env.WEB_APP_URL ||
    process.env.EDUCA_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** Razorpay redirect checkout POSTs to callback_url; Next.js pages are GET-only. */
function razorpayCallbackUrl(returnBase, { returnPath, payment, sub }) {
  const params = new URLSearchParams();
  params.set("return", returnPath);
  if (payment) params.set("payment", payment);
  if (sub) params.set("sub", sub);
  return `${returnBase}/api/razorpay/callback?${params.toString()}`;
}

function schoolHasBillingAddress(school) {
  return Boolean(
    school?.name?.trim() &&
      school?.addressLine1?.trim() &&
      school?.city?.trim() &&
      school?.pincode?.trim()
  );
}

function normalizePlanInput(body) {
  const planRaw = body?.plan || body?.priceId;
  if (!planRaw || typeof planRaw !== "string") return null;
  const trimmed = planRaw.trim();
  if (PLAN_KEYS.includes(trimmed)) return trimmed;
  for (const plan of PLAN_KEYS) {
    if (envPlanId(plan) === trimmed) return plan;
  }
  return null;
}

async function applyRazorpaySubscriptionToMongo(subDoc, rzpSub, { paymentId, forceActive } = {}) {
  if (!subDoc || !rzpSub) return subDoc;

  const notes = rzpSub.notes || {};
  if (notes.plan && PLAN_KEYS.includes(notes.plan)) {
    subDoc.plan = notes.plan;
  }
  if (notes.billedSeatQuantity) {
    subDoc.billedStudentCount = Number(notes.billedSeatQuantity) || subDoc.billedStudentCount;
  } else if (rzpSub.quantity != null) {
    subDoc.billedStudentCount = Number(rzpSub.quantity);
  }

  subDoc.razorpaySubscriptionId = rzpSub.id;
  if (rzpSub.customer_id) subDoc.razorpayCustomerId = rzpSub.customer_id;
  if (rzpSub.plan_id) subDoc.razorpayPlanId = rzpSub.plan_id;
  if (paymentId) subDoc.razorpayPaymentId = paymentId;

  const mapped = mapRazorpaySubscriptionStatus(rzpSub.status);
  if (forceActive || mapped === "active") {
    subDoc.status = "active";
    subDoc.graceStartedAt = undefined;
    subDoc.graceEndsAt = undefined;
    subDoc.graceReminderDay = undefined;
    subDoc.remindersSent = { preDue3: false, preDue2: false, preDue1: false };
    subDoc.lastPaymentAt = new Date();
  } else if (mapped === "pending") {
    subDoc.status = "pending";
  } else if (rzpSub.status === "cancelled" || rzpSub.status === "completed") {
    subDoc.status = "inactive";
    subDoc.canceledAt = subDoc.canceledAt || new Date();
  } else if (mapped === "inactive") {
    subDoc.status = "inactive";
  }

  const bounds = periodBoundsFromRazorpaySubscription(rzpSub);
  if (bounds.currentPeriodStart) subDoc.currentPeriodStart = bounds.currentPeriodStart;
  if (bounds.currentPeriodEnd) subDoc.currentPeriodEnd = bounds.currentPeriodEnd;

  await subDoc.save();
  return subDoc;
}

async function applySchoolPlanPaymentToMongo(subDoc, { paymentId, orderId, plan, seatCount } = {}) {
  if (!subDoc) return subDoc;

  const planKey = plan && PLAN_KEYS.includes(plan) ? plan : subDoc.plan;
  if (planKey) subDoc.plan = planKey;
  if (seatCount != null) {
    subDoc.billedStudentCount = Math.max(1, Number(seatCount) || subDoc.billedStudentCount);
  }
  if (orderId) subDoc.razorpayOrderId = orderId;
  if (paymentId) subDoc.razorpayPaymentId = paymentId;

  const bounds = periodBoundsForPlan(subDoc.plan, new Date());
  subDoc.currentPeriodStart = bounds.currentPeriodStart;
  subDoc.currentPeriodEnd = bounds.currentPeriodEnd;
  subDoc.status = "active";
  subDoc.graceStartedAt = undefined;
  subDoc.graceEndsAt = undefined;
  subDoc.graceReminderDay = undefined;
  subDoc.remindersSent = { preDue3: false, preDue2: false, preDue1: false };
  subDoc.lastPaymentAt = new Date();

  await subDoc.save();
  return subDoc;
}

/**
 * POST /api/subscription/checkout — school_admin
 * body: { plan: "monthly"|"quarterly"|"yearly" } (priceId accepted as plan id alias)
 */
exports.createCheckoutSession = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: "Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Only school administrators can subscribe" });
    }

    const school = await School.findById(user.schoolId);
    if (!school || school.verificationStatus !== "Verified") {
      return res.status(403).json({ message: "School must be verified before subscribing" });
    }

    if (!schoolHasBillingAddress(school)) {
      return res.status(400).json({
        message:
          "Complete your school profile (name, address line 1, city, PIN code) before paying.",
      });
    }

    const trialAccess = await getSchoolBillingAccess(school._id, {
      school: {
        verificationStatus: school.verificationStatus,
        verifiedAt: school.verifiedAt,
        createdAt: school.createdAt,
        freeTrialDisabled: school.freeTrialDisabled,
        trialEndsAtOverride: school.trialEndsAtOverride,
      },
    });
    if (trialAccess.inTrial) {
      return res.status(403).json({
        message: "Your school is still in the free trial. You can subscribe after the trial ends.",
        code: "TRIAL_ACTIVE_NO_CHECKOUT",
      });
    }

    const plan = normalizePlanInput(req.body);
    if (!plan) {
      return res.status(400).json({
        message: 'plan is required — one of "monthly", "quarterly", "yearly" (from /api/subscription/catalog)',
      });
    }

    const returnBase = String(req.body?.returnOrigin || webAppBase()).replace(/\/$/, "");

    const billing = await getBillingSettingsDoc();
    const includedSeats = await countIncludedSeatStudents(school._id);
    if (includedSeats < 1) {
      return res.status(400).json({
        message:
          "Add at least one student with an included seat before subscribing. (Pending-seat students do not count until activated.)",
      });
    }

    const synced = await syncRazorpayPlansByCadence();
    const razorpayPlan = synced.get(plan) || null;
    const unitPaise =
      razorpayPlan?.item?.amount != null
        ? Number(razorpayPlan.item.amount)
        : planAmountPaise(plan, 1, billing.pricePerStudentYearInr);
    if (unitPaise * includedSeats < 100) {
      return res.status(400).json({ message: "Total subscription amount too small" });
    }

    let subDoc = await SchoolSubscription.findOne({ schoolId: school._id });
    if (!subDoc) {
      subDoc = new SchoolSubscription({
        schoolId: school._id,
      plan,
        billingMode: "per_seat",
        billedStudentCount: includedSeats,
        pricePerStudentYearInr: billing.pricePerStudentYearInr,
        status: "pending",
      });
    } else {
      subDoc.plan = plan;
      subDoc.billingMode = "per_seat";
      subDoc.billedStudentCount = includedSeats;
      subDoc.pricePerStudentYearInr = billing.pricePerStudentYearInr;
      subDoc.status = "pending";
    }

    try {
      const razorpayPlanId = await resolvePlanId(plan, billing.pricePerStudentYearInr);
      subDoc.razorpayPlanId = razorpayPlanId;
    } catch (planErr) {
      console.warn("checkout resolvePlanId (optional for one-time order):", planErr?.message || planErr);
    }

    const customerId = await ensureRazorpayCustomer(subDoc, school);
    subDoc.razorpayCustomerId = customerId;
    await subDoc.save();

    const amountPaise = unitPaise * includedSeats;
    const order = await createSchoolPlanOrder({
      amountPaise,
      schoolId: school._id,
        plan,
      mongoSubscriptionId: subDoc._id,
      seatCount: includedSeats,
    });

    subDoc.razorpayOrderId = order.id;
    await subDoc.save();

    const callbackUrl = razorpayCallbackUrl(returnBase, {
      returnPath: "/dashboard/subscription",
      sub: "success",
    });

    return res.json({
      data: {
        keyId: razorpayKeyId(),
        orderId: order.id,
        checkoutType: "order",
        plan,
        quantity: includedSeats,
        amountPaise,
        amountInr: amountPaise / 100,
        currency: "INR",
        customerId,
        callbackUrl,
        successUrl: callbackUrl,
        cancelUrl: `${returnBase}/dashboard/subscription?sub=canceled`,
      },
    });
  } catch (err) {
    console.error("createCheckoutSession:", err);
    const raw =
      err?.error?.description || err?.error?.reason || err?.message || "Checkout failed";
    const isRazorpayAuth =
      /authentication failed/i.test(String(raw)) ||
      err?.statusCode === 401 ||
      (err?.error?.code === "BAD_REQUEST_ERROR" &&
        /auth/i.test(String(err?.error?.description || "")));
    if (isRazorpayAuth) {
      return res.status(502).json({
        message:
          "Payment gateway authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server (live keys for production, test keys for test mode — both must be from the same Razorpay account and mode).",
        code: "RAZORPAY_AUTH_FAILED",
      });
    }
    return res.status(500).json({ message: raw });
  }
};

exports.getPublicSubscriptionCatalog = async (req, res) => {
  try {
    const billing = await getBillingSettingsDoc();
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const base = await loadSubscriptionCatalogPrices(0, billing.pricePerStudentYearInr, { force });
    return res.json({
      data: {
        razorpayConfigured: base.razorpayConfigured,
        product: base.product,
        prices: base.prices,
        planWarnings: base.planWarnings || [],
      },
    });
  } catch (err) {
    console.error("getPublicSubscriptionCatalog:", err);
    return res.status(500).json({ message: err.message || "Failed to load catalog" });
  }
};

exports.getSubscriptionCatalog = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const billing = await getBillingSettingsDoc();
    const rosterCount = await countRosterActiveStudents(user.schoolId);
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const base = await loadSubscriptionCatalogPrices(includedSeatCount, billing.pricePerStudentYearInr, {
      force,
    });

    return res.json({
      data: {
        razorpayConfigured: base.razorpayConfigured,
        product: base.product,
        prices: base.prices,
        planWarnings: base.planWarnings || [],
        activeStudentCount: rosterCount,
        includedSeatStudentCount: includedSeatCount,
      },
    });
  } catch (err) {
    console.error("getSubscriptionCatalog:", err);
    return res.status(500).json({ message: err.message || "Failed to load catalog" });
  }
};

exports.getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const billing = await getBillingSettingsDoc();
    const school = await School.findById(user.schoolId)
      .select("name email verificationStatus verifiedAt createdAt freeTrialDisabled trialEndsAtOverride")
      .lean();
    const trialAccess = await getSchoolBillingAccess(user.schoolId, { school });

    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();

    const rosterCount = await countRosterActiveStudents(user.schoolId);
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);

    const plan = sub?.plan || null;
    const statusOut = sub?.status ?? null;
    const synced = await syncRazorpayPlansByCadence();
    const getPlanUnitPaise = (pKey) => {
      const rp = synced.get(pKey);
      return rp?.item?.amount != null
        ? Number(rp.item.amount)
        : planAmountPaise(pKey, 1, billing.pricePerStudentYearInr);
    };

    const amountPaise =
      plan && ["monthly", "quarterly", "yearly"].includes(plan)
        ? getPlanUnitPaise(plan) * includedSeatCount
        : null;

    const amountsInr =
      includedSeatCount >= 1
        ? {
            monthly: (getPlanUnitPaise("monthly") * includedSeatCount) / 100,
            quarterly: (getPlanUnitPaise("quarterly") * includedSeatCount) / 100,
            yearly: (getPlanUnitPaise("yearly") * includedSeatCount) / 100,
          }
        : null;

    return res.json({
      data: {
        school: { name: school?.name, email: school?.email },
        activeStudentCount: rosterCount,
        includedSeatCount,
        billedSeatCount: sub?.billedStudentCount ?? null,
        pricePerStudentYearInr: billing.pricePerStudentYearInr,
        plan,
        amountsInr,
        currentPeriodAmountInr: amountPaise != null ? amountPaise / 100 : null,
        status: statusOut,
        currentPeriodStart: sub?.currentPeriodStart,
        currentPeriodEnd: sub?.currentPeriodEnd,
        graceEndsAt: sub?.graceEndsAt,
        adminUnblockUntil: sub?.adminUnblockUntil,
        lastPaymentAt: sub?.lastPaymentAt,
        billingMode: sub?.billingMode || null,
        razorpayConfigured: isRazorpayConfigured(),
        razorpayOrderId: sub?.razorpayOrderId || null,
        razorpaySubscriptionId: sub?.razorpaySubscriptionId || null,
        trialEndsAt: trialAccess.trialEndsAt,
        inTrial: trialAccess.inTrial,
        needsSubscription: trialAccess.needsSubscription,
        hasBillingAccess: trialAccess.allowed,
        staleSubscriptionIgnored: false,
      },
    });
  } catch (err) {
    console.error("getSubscriptionStatus:", err);
    return res.status(500).json({ message: "Failed to load subscription" });
  }
};

exports.syncStudentCount = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: "Razorpay not configured" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId });
    if (!sub?.razorpaySubscriptionId) {
      return res.status(400).json({
        message: "Seat sync is only for recurring Razorpay subscriptions. One-time payments do not need sync.",
      });
    }

    const billing = await getBillingSettingsDoc();
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);

    if (sub.billingMode === "per_seat") {
      await updateSubscriptionQuantity(sub.razorpaySubscriptionId, includedSeatCount);
      sub.billedStudentCount = includedSeatCount;
      sub.pricePerStudentYearInr = billing.pricePerStudentYearInr;
      await sub.save();

      return res.json({
        message: "Subscription seat count updated in Razorpay",
        data: { activeStudentCount: includedSeatCount, billingMode: "per_seat" },
      });
    }

    return res.status(400).json({ message: "Only per-seat subscriptions can be synced" });
  } catch (err) {
    console.error("syncStudentCount:", err);
    return res.status(500).json({ message: err.message || "Sync failed" });
  }
};

/**
 * POST /api/subscription/verify-payment — school_admin
 * body (one-time): { razorpay_payment_id, razorpay_order_id, razorpay_signature }
 * body (legacy mandate): { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
 */
exports.verifyPayment = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: "Razorpay is not configured" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const schoolForTrial = await School.findById(user.schoolId)
      .select("verificationStatus verifiedAt createdAt")
      .lean();
    const trialAccess = await getSchoolBillingAccess(user.schoolId, { school: schoolForTrial });
    if (trialAccess.inTrial) {
      return res.status(403).json({
        message: "Your school is still in the free trial.",
        code: "TRIAL_ACTIVE_NO_CHECKOUT",
      });
    }

    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body || {};

    if (!razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "razorpay_payment_id and razorpay_signature are required" });
    }

    const subDoc = await SchoolSubscription.findOne({ schoolId: user.schoolId });
    if (!subDoc) {
      return res.status(404).json({ message: "School subscription record not found" });
    }

    if (razorpay_order_id) {
      if (
        !verifyOrderPaymentSignature({
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
        })
      ) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      const { getRazorpay } = require("../utils/razorpayService");
      const rzp = getRazorpay();
      if (!rzp) {
        return res.status(503).json({ message: "Razorpay not configured" });
      }

      const payment = await rzp.payments.fetch(razorpay_payment_id);
      const notes = payment.notes || {};
      if (notes.type !== "school_plan") {
        return res.status(400).json({ message: "Payment is not a school plan order" });
      }
      const schoolId = notes.school_id || notes.schoolId;
      if (!schoolId || String(schoolId) !== String(user.schoolId)) {
        return res.status(403).json({ message: "Payment does not belong to your school" });
      }

      await applySchoolPlanPaymentToMongo(subDoc, {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        plan: notes.plan,
        seatCount: Number(notes.seat_count),
      });
    } else if (razorpay_subscription_id) {
      if (
        !verifySubscriptionPaymentSignature({
          razorpay_payment_id,
          razorpay_subscription_id,
          razorpay_signature,
        })
      ) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      const rzpSub = await fetchSubscription(razorpay_subscription_id);
      if (!rzpSub) {
        return res.status(404).json({ message: "Subscription not found in Razorpay" });
      }

      const notesSchoolId = rzpSub.notes?.schoolId ? String(rzpSub.notes.schoolId) : null;
      if (!notesSchoolId || notesSchoolId !== String(user.schoolId)) {
        return res.status(403).json({ message: "This subscription does not belong to your school" });
      }

      await applyRazorpaySubscriptionToMongo(subDoc, rzpSub, {
        paymentId: razorpay_payment_id,
        forceActive: true,
      });
    } else {
      return res.status(400).json({
        message: "razorpay_order_id (one-time) or razorpay_subscription_id (legacy) is required",
      });
    }

    const refreshed = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();
    return res.json({
      message: "Payment verified",
      data: {
        status: subscriptionStatusForClient(refreshed?.status),
        razorpayOrderId: refreshed?.razorpayOrderId,
        razorpaySubscriptionId: refreshed?.razorpaySubscriptionId,
        currentPeriodEnd: refreshed?.currentPeriodEnd,
      },
    });
  } catch (err) {
    console.error("verifyPayment:", err);
    return res.status(500).json({ message: err.message || "Could not verify payment" });
  }
};

/** Alias for confirm-session route (same as verify-payment). */
exports.confirmCheckoutSession = exports.verifyPayment;

/**
 * POST /api/subscription/sync-from-razorpay — school_admin
 * Legacy recurring-subscription fallback.
 */
exports.syncSubscriptionFromRazorpay = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const subDoc = await SchoolSubscription.findOne({ schoolId: user.schoolId });
    if (!subDoc?.razorpaySubscriptionId) {
      return res.status(400).json({
        message: "No recurring Razorpay subscription to sync. Use verify-payment after order checkout.",
      });
    }

    const rzpSub = await fetchSubscription(subDoc.razorpaySubscriptionId);
    if (!rzpSub) {
      return res.status(404).json({ message: "Subscription not found in Razorpay" });
    }

    const notesSchoolId = rzpSub.notes?.schoolId ? String(rzpSub.notes.schoolId) : null;
    if (notesSchoolId && notesSchoolId !== String(user.schoolId)) {
      return res.status(403).json({ message: "This subscription does not belong to your school" });
    }

    const isPaid =
      rzpSub.status === "active" ||
      rzpSub.status === "authenticated" ||
      Number(rzpSub.paid_count) > 0;

    await applyRazorpaySubscriptionToMongo(subDoc, rzpSub, {
      forceActive: isPaid,
    });

    const refreshed = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();
    return res.json({
      message: "Synced from Razorpay",
      data: {
        status: subscriptionStatusForClient(refreshed?.status),
        razorpayStatus: rzpSub.status,
        currentPeriodEnd: refreshed?.currentPeriodEnd,
      },
    });
  } catch (err) {
    console.error("syncSubscriptionFromRazorpay:", err);
    return res.status(500).json({ message: err.message || "Could not sync subscription" });
  }
};

/**
 * POST /api/subscription/cancel — school_admin
 * body: { cancelAtCycleEnd?: boolean }
 */
exports.cancelSchoolSubscription = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: "Razorpay not configured" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId });
    if (!sub?.razorpaySubscriptionId) {
      return res.status(400).json({ message: "No Razorpay subscription to cancel" });
    }

    const cancelAtCycleEnd = Boolean(req.body?.cancelAtCycleEnd);
    await cancelSubscription(sub.razorpaySubscriptionId, cancelAtCycleEnd);

    if (!cancelAtCycleEnd) {
      sub.status = "inactive";
      sub.canceledAt = new Date();
      await sub.save();
    }

    return res.json({
      message: cancelAtCycleEnd
        ? "Subscription will cancel at the end of the current billing period"
        : "Subscription cancelled",
    });
  } catch (err) {
    console.error("cancelSchoolSubscription:", err);
    return res.status(500).json({ message: err.message || "Cancel failed" });
  }
};

async function handleSubscriptionCharged(payload) {
  const rzpSub = payload.subscription?.entity || payload.subscription;
  const payment = payload.payment?.entity || payload.payment;
  if (!rzpSub?.id) return;

  const schoolId = rzpSub.notes?.schoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  await applyRazorpaySubscriptionToMongo(subDoc, rzpSub, {
    paymentId: payment?.id,
    forceActive: true,
  });
}

async function handleSubscriptionActivated(payload) {
  const rzpSub = payload.subscription?.entity || payload.subscription;
  if (!rzpSub?.id) return;
  const schoolId = rzpSub.notes?.schoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  await applyRazorpaySubscriptionToMongo(subDoc, rzpSub, { forceActive: true });
}

async function handleSubscriptionCancelled(payload) {
  const rzpSub = payload.subscription?.entity || payload.subscription;
  if (!rzpSub?.id) return;
  const schoolId = rzpSub.notes?.schoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  subDoc.status = "inactive";
  subDoc.canceledAt = new Date();
  const bounds = periodBoundsFromRazorpaySubscription(rzpSub);
  if (bounds.currentPeriodEnd) subDoc.currentPeriodEnd = bounds.currentPeriodEnd;
  await subDoc.save();
}

async function handlePaymentFailed(payload) {
  const payment = payload.payment?.entity || payload.payment;
  const rzpSub = payload.subscription?.entity || payload.subscription;
  const schoolId =
    rzpSub?.notes?.schoolId || payment?.notes?.schoolId || payment?.notes?.school_id;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  subDoc.status = "inactive";
  subDoc.graceStartedAt = undefined;
  subDoc.graceEndsAt = undefined;
  subDoc.graceReminderDay = undefined;
  await subDoc.save();

  const school = await School.findById(schoolId).select("email name").lean();
  if (school?.email) {
    await sendMail({
      to: school.email,
      subject: "Payment failed — subscription access paused",
      text: `Your UtthanAI subscription payment did not go through. Staff and parent access is paused until payment succeeds. The school admin can complete payment from the school billing dashboard.`,
      logContext: "subscription_payment_failed",
    });
  }
}

async function handlePendingStudentsPaymentCaptured(payment) {
  const notes = payment.notes || {};
  if (notes.type !== "pending_students") return;
  if (payment.status !== "captured") return;

  const schoolIdRaw = notes.school_id || notes.schoolId;
  if (!schoolIdRaw) return;

  const schoolId = new mongoose.Types.ObjectId(String(schoolIdRaw));

  const pendingStudents = await Student.find(
    { schoolId, status: "pending" },
    {
      _id: 1,
      name: 1,
      activationToken: 1,
      "pendingCredentialsSms.phone": 1,
      "pendingCredentialsSms.schoolName": 1,
      "pendingCredentialsSms.studentName": 1,
      "pendingCredentialsSms.classSectionLabel": 1,
      "pendingCredentialsSms.username": 1,
      "pendingCredentialsSms.password": 1,
      "pendingCredentialsSms.message": 1,
    }
  ).lean();

  const result = await Student.updateMany(
    { schoolId, status: "pending" },
    {
      $set: { status: "active", seatBillingStatus: "included" },
    }
  );

  if (result.modifiedCount === 0) return;

  const credentialLines = [];
  const whatsAppService = require("../services/whatsAppService");

  for (const s of pendingStudents) {
    const pending = s.pendingCredentialsSms || {};
    const phone = pending.phone;
    const username = pending.username;
    const password = pending.password;

    if (phone && username && password) {
      credentialLines.push(
        [
          `Student: ${pending.studentName || s.name || "Student"}`,
          pending.classSectionLabel ? `Class: ${pending.classSectionLabel}` : null,
          `Parent phone: ${phone}`,
          `Username: ${username}`,
          `Password: ${password}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else if (phone && pending.message) {
      console.warn(
        `[sms] Student ${s._id} has legacy pendingCredentialsSms.message only; share credentials manually.`,
      );
    }

    if (phone && s.activationToken) {
      const studentName = s.name || pending.studentName || "Student";
      whatsAppService.sendStudentActivationMessage(phone, studentName, s.activationToken, "en")
        .then((waResult) => {
          if (waResult.ok) {
            console.info("[subscription:activation] WhatsApp message sent", {
              studentId: s._id,
              phone,
            });
          } else {
            console.error("[subscription:activation] WhatsApp send failure", {
              studentId: s._id,
              phone,
              error: waResult.error,
            });
          }
        })
        .catch((err) => {
          console.error("[subscription:activation] WhatsApp send failure", {
            studentId: s._id,
            phone,
            error: err.message || err,
          });
        });
    }
  }

  if (credentialLines.length) {
    const school = await School.findById(schoolId).select("name email").lean();
    const schoolAdmin = await User.findOne({ schoolId, role: "school_admin" })
      .select("email")
      .lean();
    const to = school?.email || schoolAdmin?.email;

    if (to) {
      await sendMail({
        to,
        subject: "Pending students activated - share parent login details",
        text:
          `The following pending students are now active for ${school?.name || "your school"}.\n\n` +
          "Server-side SMS delivery has been removed. Please share these login details with the parent phone numbers below:\n\n" +
          credentialLines.join("\n\n---\n\n"),
        logContext: "pending_students_parent_credentials",
      });
    } else {
      console.warn(
        "[sms] Pending student credentials prepared, but no school email/admin email is available",
      );
    }
  }
  const includedSeatCount = await countIncludedSeatStudents(schoolIdRaw);
  await SchoolSubscription.updateOne(
    { schoolId: schoolIdRaw },
    { $set: { billedStudentCount: includedSeatCount } }
  );

  const subDoc = await SchoolSubscription.findOne({ schoolId: schoolIdRaw });
  if (subDoc?.razorpaySubscriptionId && subDoc.billingMode === "per_seat") {
    try {
      await updateSubscriptionQuantity(subDoc.razorpaySubscriptionId, includedSeatCount);
    } catch (e) {
      console.error("pending_students Razorpay quantity sync:", e);
    }
  }
}

exports.handleRazorpayWebhook = async (req, res) => {
  const whSecret = require("../utils/razorpayService").webhookSecret();
  if (!isRazorpayConfigured() || !whSecret) {
    return res.status(503).send("Razorpay webhook not configured");
  }

  const signature = req.headers["x-razorpay-signature"];
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(400).send("Invalid webhook signature");
  }

  let event;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    event = JSON.parse(raw);
  } catch (err) {
    return res.status(400).send(`Webhook parse error: ${err.message}`);
  }

  try {
    const eventType = event.event;
    const payload = event.payload || {};

    switch (eventType) {
      case "subscription.charged":
        await handleSubscriptionCharged(payload);
        break;
      case "subscription.activated":
        await handleSubscriptionActivated(payload);
        break;
      case "subscription.cancelled":
      case "subscription.completed":
        await handleSubscriptionCancelled(payload);
        break;
      case "subscription.halted":
      case "subscription.pending": {
        const rzpSub = payload.subscription?.entity;
        if (rzpSub?.notes?.schoolId) {
          const subDoc = await SchoolSubscription.findOne({ schoolId: rzpSub.notes.schoolId });
          if (subDoc) {
            await applyRazorpaySubscriptionToMongo(subDoc, rzpSub, {
              forceActive: eventType === "subscription.pending",
            });
          }
        }
        break;
      }
      case "payment.failed":
        await handlePaymentFailed(payload);
        break;
      case "payment.captured": {
        const payment = payload.payment?.entity;
        if (payment) await handlePendingStudentsPaymentCaptured(payment);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({ received: false });
  }

  return res.json({ received: true });
};

exports.getPendingStudentsActivationQuote = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Only school administrators can view this" });
    }
    const schoolId = user.schoolId;
    const subscriptionActive = await isSchoolSubscriptionActivePaid(schoolId);
    const sub = await SchoolSubscription.findOne({ schoolId }).lean();
    const pendingCount = await countPendingActivationStudents(schoolId);
    const pricePerYear = await getPricePerStudentYearInr();
    const planEnd = sub?.currentPeriodEnd || null;
    const planExpired = !planEnd || new Date(planEnd) <= new Date();
    let amountInr = 0;
    let amountSource = "none";
    if (pendingCount > 0 && !planExpired) {
      const resolved = await resolvePendingStudentsAmountInr(
        schoolId,
        pendingCount,
        sub,
        pricePerYear
      );
      amountInr = resolved.amountInr;
      amountSource = resolved.source;
    }

    return res.json({
      pendingCount,
      amountInr,
      amountSource,
      currency: "inr",
      plan: sub?.plan ?? null,
      planEndDate: planEnd,
      currentPeriodStart: sub?.currentPeriodStart ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      pricePerStudentYearInr: pricePerYear,
      subscriptionActive,
      planExpired,
      canCheckout: subscriptionActive && pendingCount > 0 && !planExpired,
    });
  } catch (err) {
    console.error("getPendingStudentsActivationQuote:", err);
    return res.status(500).json({ message: err.message || "Could not load quote" });
  }
};

/**
 * POST /api/schools/:id/create-pending-checkout — one-time Razorpay order for pending students.
 */
exports.createPendingStudentsCheckout = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: "Razorpay is not configured" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Only school administrators can checkout" });
    }

    const paramId = req.params.id;
    if (!paramId || String(user.schoolId) !== String(paramId)) {
      return res.status(403).json({ message: "You can only checkout for your own school" });
    }

    const returnBase = String(req.body?.returnOrigin || webAppBase()).replace(/\/$/, "");

    const schoolId = user.schoolId;
    const school = await School.findById(schoolId);
    if (!school || school.verificationStatus !== "Verified") {
      return res.status(403).json({ message: "School must be verified before paying" });
    }

    if (!schoolHasBillingAddress(school)) {
      return res.status(400).json({
        message: "Complete your school profile (name, address line 1, city, PIN code) before paying.",
      });
    }

    if (!(await isSchoolSubscriptionActivePaid(schoolId))) {
      return res.status(400).json({
        message: "Pending student activation is only available while your subscription is active.",
        code: "SUBSCRIPTION_NOT_ACTIVE",
      });
    }

    const subDoc = await SchoolSubscription.findOne({ schoolId });
    if (!subDoc || subDoc.status !== "active") {
      return res.status(400).json({ message: "No active subscription found for this school" });
    }

    if (!subDoc.currentPeriodEnd || new Date(subDoc.currentPeriodEnd) <= new Date()) {
      return res.status(400).json({
        message: "Your billing period has ended. Renew your plan before activating pending students.",
        code: "PLAN_EXPIRED",
      });
    }

    const pendingCount = await countPendingActivationStudents(schoolId);
    if (pendingCount < 1) {
      return res.status(400).json({
        message: "There are no pending students to activate.",
        code: "NO_PENDING_STUDENTS",
      });
    }

    const pricePerYear = await getPricePerStudentYearInr();
    const { amountInr: resolvedInr } = await resolvePendingStudentsAmountInr(
      schoolId,
      pendingCount,
      subDoc,
      pricePerYear
    );
    const amountInr = Math.max(1, resolvedInr);
    const unitAmountPaise = Math.max(100, Math.round(amountInr * 100));

    const customerId = await ensureRazorpayCustomer(subDoc, school);
    if (!subDoc.razorpayCustomerId) {
      subDoc.razorpayCustomerId = customerId;
      await subDoc.save();
    }

    const order = await createPendingStudentsOrder({
      amountPaise: unitAmountPaise,
      schoolId: school._id,
      pendingCount,
    });

    const callbackUrl = razorpayCallbackUrl(returnBase, {
      returnPath: "/dashboard/students",
      payment: "success",
    });

    return res.json({
      data: {
        keyId: razorpayKeyId(),
        orderId: order.id,
        amountPaise: order.amount,
        amountInr: order.amount / 100,
        currency: order.currency,
        customerId,
        description: `Student seat activation, prorated (${pendingCount} seat(s)) — ${school.name}`,
        callbackUrl,
        successUrl: callbackUrl,
        cancelUrl: `${returnBase}/dashboard/students?payment=cancel`,
      },
    });
  } catch (err) {
    console.error("createPendingStudentsCheckout:", err);
    return res.status(500).json({ message: err.message || "Could not create checkout" });
  }
};

/**
 * POST /api/subscription/verify-pending-payment — after Razorpay order checkout for pending students.
 */
exports.verifyPendingStudentsPayment = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body || {};

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing Razorpay payment fields" });
    }

    if (
      !verifyOrderPaymentSignature({
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature,
      })
    ) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const { getRazorpay } = require("../utils/razorpayService");
    const rzp = getRazorpay();
    if (!rzp) {
      return res.status(503).json({ message: "Razorpay not configured" });
    }

    const payment = await rzp.payments.fetch(razorpay_payment_id);
    const notes = payment.notes || {};
    const schoolId = notes.school_id || notes.schoolId;
    if (!schoolId || String(schoolId) !== String(user.schoolId)) {
      return res.status(403).json({ message: "Payment does not belong to your school" });
    }

    await handlePendingStudentsPaymentCaptured(payment);

    return res.json({ message: "Pending students activated" });
  } catch (err) {
    console.error("verifyPendingStudentsPayment:", err);
    return res.status(500).json({ message: err.message || "Verification failed" });
  }
};

exports.runSubscriptionReminderJobs = async () => {
  const subs = await SchoolSubscription.find({
    status: { $in: ["trialing", "active"] },
    currentPeriodEnd: { $ne: null },
  });

  const now = new Date();
  const dayMs = 86400000;

  for (const sub of subs) {
    const school = await School.findById(sub.schoolId).select("email name").lean();
    if (!school?.email) continue;

    const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    if (!end) continue;

    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / dayMs);
    if (daysLeft === 3 && !sub.remindersSent.preDue3) {
      sub.remindersSent.preDue3 = true;
      await sub.save();
      await sendMail({
        to: school.email,
        subject: "Subscription renews in 3 days",
        text: `Your school subscription will renew in about 3 days (${end.toDateString()}). Ensure your payment method is up to date.`,
        logContext: "sub_reminder_3d",
      });
    } else if (daysLeft === 2 && !sub.remindersSent.preDue2) {
      sub.remindersSent.preDue2 = true;
      await sub.save();
      await sendMail({
        to: school.email,
        subject: "Subscription renews in 2 days",
        text: `Reminder: subscription renewal in 2 days (${end.toDateString()}).`,
        logContext: "sub_reminder_2d",
      });
    } else if (daysLeft === 1 && !sub.remindersSent.preDue1) {
      sub.remindersSent.preDue1 = true;
      await sub.save();
      await sendMail({
        to: school.email,
        subject: "Subscription renews tomorrow",
        text: `Your subscription renews tomorrow (${end.toDateString()}).`,
        logContext: "sub_reminder_1d",
      });
    }
  }
};

exports.runTrialExpiryStatusSyncJob = async () => {
  const subs = await SchoolSubscription.find({ status: "trialing" })
    .select("schoolId status")
    .lean();

  if (!subs.length) return { scanned: 0, changed: 0 };

  const schoolIds = subs.map((s) => s.schoolId);
  const schools = await School.find({ _id: { $in: schoolIds } })
    .select("_id verificationStatus verifiedAt createdAt")
    .lean();
  const bySchoolId = new Map(schools.map((s) => [String(s._id), s]));

  let changed = 0;
  const nowMs = Date.now();

  for (const sub of subs) {
    const school = bySchoolId.get(String(sub.schoolId));
    const trialEnds = trialEndsAtFromSchool(school);
    if (!school || school.verificationStatus !== "Verified" || !trialEnds) continue;
    if (trialEnds.getTime() > nowMs) continue;

    await SchoolSubscription.updateOne(
      { _id: sub._id, status: "trialing" },
      { $set: { status: "inactive" } }
    );
    changed += 1;
  }

  return { scanned: subs.length, changed };
};
