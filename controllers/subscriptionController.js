const mongoose = require("mongoose");
const Stripe = require("stripe");
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
const { planAmountPaise, stripeIntervalForPlan } = require("../utils/subscriptionPricing");
const { getSchoolBillingAccess, trialEndsAtFromSchool } = require("../utils/subscriptionAccess");
const {
  countRosterActiveStudents,
  countIncludedSeatStudents,
} = require("../utils/studentSeatBilling");
const { sendMail } = require("../utils/mail");
const { sendSms } = require("../utils/smsService");

function stripeSecretKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  return typeof k === "string" ? k.trim() : "";
}

function stripeProductId() {
  const p = process.env.STRIPE_PRODUCT_ID;
  return typeof p === "string" ? p.trim() : "";
}

function isStripeConfigured() {
  return Boolean(stripeSecretKey() && stripeProductId());
}

function getStripe() {
  const key = stripeSecretKey();
  if (!key) return null;
  return new Stripe(key);
}

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

/** Normalize DB/webhook status for API clients. */
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

function inferPlanFromRecurring(recurring) {
  if (!recurring) return "custom";
  const ic = recurring.interval_count || 1;
  if (recurring.interval === "month" && ic === 1) return "monthly";
  if (recurring.interval === "month" && ic === 3) return "quarterly";
  if (recurring.interval === "year" && ic === 1) return "yearly";
  return "custom";
}

function recurringSortKey(recurring) {
  if (!recurring) return 9999;
  const ic = recurring.interval_count || 1;
  if (recurring.interval === "year") return ic * 12;
  if (recurring.interval === "month") return ic;
  if (recurring.interval === "week") return ic / 4;
  return 100 + ic;
}

function formatRecurringLabel(recurring) {
  if (!recurring) return "per period";
  const ic = recurring.interval_count || 1;
  if (recurring.interval === "month" && ic === 1) return "per month";
  if (recurring.interval === "month" && ic === 3) return "per quarter";
  if (recurring.interval === "year" && ic === 1) return "per year";
  if (ic === 1) return `per ${recurring.interval}`;
  return `every ${ic} ${recurring.interval}s`;
}

function schoolHasStripeExportAddress(school) {
  return Boolean(
    school?.name?.trim() &&
      school?.addressLine1?.trim() &&
      school?.city?.trim() &&
      school?.pincode?.trim()
  );
}

function stripeAddressFromSchool(school) {
  return {
    line1: school.addressLine1.trim(),
    line2: school.addressLine2?.trim() || undefined,
    city: school.city.trim(),
    state: school.state?.trim() || undefined,
    postal_code: school.pincode.trim(),
    country: "IN",
  };
}

/**
 * Indian export rules: Stripe needs customer name + address on the Customer and/or Checkout.
 * @see https://stripe.com/docs/india-exports
 */
async function ensureStripeCustomerForSchoolCheckout(stripe, subDoc, school) {
  const address = stripeAddressFromSchool(school);
  const payload = {
    name: school.name.trim(),
    address,
    metadata: { schoolId: school._id.toString(), source: "educa_subscription" },
  };
  const em = school.email?.trim();
  if (em) payload.email = em;
  if (school.phone?.trim()) payload.phone = school.phone.trim();

  if (subDoc.stripeCustomerId) {
    await stripe.customers.update(subDoc.stripeCustomerId, payload);
    return subDoc.stripeCustomerId;
  }

  const customer = await stripe.customers.create(payload);
  return customer.id;
}

/**
 * India exports + consistent UX: billing details on Checkout, same payment method options as subscription.
 * @see https://stripe.com/docs/india-exports
 */
function applyStripeCheckoutBillingAndPayments(sessionConfig) {
  sessionConfig.billing_address_collection = "required";
  sessionConfig.customer_update = {
    address: "auto",
    name: "auto",
  };

  const pmcId = process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID?.trim();
  const pmTypesEnv = process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES?.trim();
  const apmOff = process.env.STRIPE_CHECKOUT_AUTOMATIC_PAYMENT_METHODS === "false";

  if (pmcId) {
    sessionConfig.payment_method_configuration = pmcId;
  } else if (pmTypesEnv) {
    const list = pmTypesEnv.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) sessionConfig.payment_method_types = list;
  } else if (!apmOff) {
    sessionConfig.automatic_payment_methods = { enabled: true };
  } else {
    sessionConfig.payment_method_types = ["card"];
  }
}

/**
 * POST /api/subscription/checkout — school_admin
 * body: { priceId: string } — recurring price on STRIPE_PRODUCT_ID; quantity is always active students on the roster.
 */
exports.createCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe is not configured (STRIPE_SECRET_KEY)" });
    }

    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Only school administrators can subscribe" });
    }

    const school = await School.findById(user.schoolId);
    if (!school || school.verificationStatus !== "Verified") {
      return res.status(403).json({ message: "School must be verified before subscribing" });
    }

    if (!schoolHasStripeExportAddress(school)) {
      return res.status(400).json({
        message:
          "Complete your school profile (name, address line 1, city, PIN code) before paying. Stripe requires this for India export compliance.",
      });
    }

    const trialAccess = await getSchoolBillingAccess(school._id, {
      school: {
        verificationStatus: school.verificationStatus,
        verifiedAt: school.verifiedAt,
        createdAt: school.createdAt,
      },
    });
    if (trialAccess.inTrial) {
      return res.status(403).json({
        message:
          "Your school is still in the free trial. You can subscribe after the trial ends.",
        code: "TRIAL_ACTIVE_NO_CHECKOUT",
      });
    }

    const { priceId } = req.body;
    if (!priceId || typeof priceId !== "string") {
      return res.status(400).json({ message: "priceId is required (load plans from /api/subscription/catalog)" });
    }

    const productId = stripeProductId();
    if (!productId) {
      return res.status(503).json({
        message: "Missing STRIPE_PRODUCT_ID — create a Product in Stripe Dashboard and set the id in .env",
      });
    }

    const stripePrice = await stripe.prices.retrieve(priceId);
    if (!stripePrice.active) {
      return res.status(400).json({ message: "This price is not active" });
    }
    if (stripePrice.type !== "recurring") {
      return res.status(400).json({ message: "Only recurring prices can be used for subscriptions" });
    }
    const priceProductId = typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product?.id;
    if (priceProductId !== productId) {
      return res.status(400).json({ message: "Price does not belong to the configured subscription product" });
    }

    const billing = await getBillingSettingsDoc();
    const includedSeats = await countIncludedSeatStudents(school._id);
    if (includedSeats < 1) {
      return res.status(400).json({
        message:
          "Add at least one student with an included seat before subscribing. (Pending-seat students do not count until activated.)",
      });
    }

    const studentCount = includedSeats;

    const unitMinor = stripePrice.unit_amount;
    if (unitMinor == null || unitMinor < 1) {
      return res.status(400).json({ message: "Price must have a positive unit amount" });
    }
    if (unitMinor * studentCount < 50) {
      return res.status(400).json({ message: "Total subscription amount too small for Stripe" });
    }

    const plan = inferPlanFromRecurring(stripePrice.recurring);

    let subDoc = await SchoolSubscription.findOne({ schoolId: school._id });
    if (!subDoc) {
      subDoc = new SchoolSubscription({
        schoolId: school._id,
        plan,
        billingMode: "per_seat",
        billedStudentCount: studentCount,
        pricePerStudentYearInr: billing.pricePerStudentYearInr,
        status: "inactive",
        stripePriceId: priceId,
      });
    } else {
      subDoc.plan = plan;
      subDoc.billingMode = "per_seat";
      subDoc.billedStudentCount = studentCount;
      subDoc.pricePerStudentYearInr = billing.pricePerStudentYearInr;
      subDoc.stripePriceId = priceId;
    }

    const stripeCustomerId = await ensureStripeCustomerForSchoolCheckout(stripe, subDoc, school);
    subDoc.stripeCustomerId = stripeCustomerId;
    await subDoc.save();

    const sessionConfig = {
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: studentCount }],
      success_url: `${webAppBase()}/dashboard/subscription?sub=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${webAppBase()}/dashboard/subscription?sub=canceled`,
      metadata: {
        schoolId: school._id.toString(),
        plan,
        stripePriceId: priceId,
        mongoSubscriptionId: subDoc._id.toString(),
        billedSeatQuantity: String(studentCount),
      },
      subscription_data: {
        metadata: {
          schoolId: school._id.toString(),
          plan,
          stripePriceId: priceId,
          billedSeatQuantity: String(studentCount),
        },
      },
    };

    applyStripeCheckoutBillingAndPayments(sessionConfig);

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionConfig);
    } catch (firstErr) {
      const msg = String(firstErr?.message || "");
      if (
        sessionConfig.automatic_payment_methods &&
        (msg.includes("automatic_payment_methods") || firstErr?.param === "automatic_payment_methods")
      ) {
        delete sessionConfig.automatic_payment_methods;
        session = await stripe.checkout.sessions.create(sessionConfig);
      } else {
        throw firstErr;
      }
    }

    return res.json({
      data: {
        url: session.url,
        sessionId: session.id,
      },
    });
  } catch (err) {
    console.error("createCheckoutSession:", err);
    return res.status(500).json({ message: err.message || "Checkout failed" });
  }
};

/**
 * Stripe product + recurring INR prices for STRIPE_PRODUCT_ID.
 * @param {number} includedSeatCount used only for totalForSchoolInr on each row (0 => null).
 */
async function loadSubscriptionStripeCatalogPrices(includedSeatCount) {
  if (!isStripeConfigured()) {
    return {
      stripeConfigured: false,
      product: null,
      prices: [],
    };
  }

  const stripe = getStripe();
  const productId = stripeProductId();

  const [product, pricesList] = await Promise.all([
    stripe.products.retrieve(productId),
    stripe.prices.list({ product: productId, active: true, type: "recurring", limit: 100 }),
  ]);

  const prices = pricesList.data
    .filter((p) => p.currency === "inr" && p.unit_amount != null && p.unit_amount >= 1)
    .sort((a, b) => recurringSortKey(a.recurring) - recurringSortKey(b.recurring))
    .map((p) => {
      const unitMinor = p.unit_amount || 0;
      return {
        id: p.id,
        nickname: p.nickname || null,
        currency: p.currency,
        unitAmountMinor: unitMinor,
        unitAmountInr: unitMinor / 100,
        interval: p.recurring?.interval,
        intervalCount: p.recurring?.interval_count || 1,
        intervalLabel: formatRecurringLabel(p.recurring),
        plan: inferPlanFromRecurring(p.recurring),
        totalForSchoolInr:
          includedSeatCount >= 1 ? (unitMinor * includedSeatCount) / 100 : null,
      };
    });

  return {
    stripeConfigured: true,
    product: {
      id: product.id,
      name: product.name,
      description: product.description || null,
    },
    prices,
  };
}

/**
 * GET /api/subscription/public-catalog — same prices as dashboard catalog, no auth (marketing site).
 */
exports.getPublicSubscriptionCatalog = async (req, res) => {
  try {
    const base = await loadSubscriptionStripeCatalogPrices(0);
    return res.json({
      data: {
        stripeConfigured: base.stripeConfigured,
        product: base.product,
        prices: base.prices,
      },
    });
  } catch (err) {
    console.error("getPublicSubscriptionCatalog:", err);
    return res.status(500).json({ message: err.message || "Failed to load catalog" });
  }
};

/**
 * GET /api/subscription/catalog — Stripe product + recurring INR prices (school_admin)
 */
exports.getSubscriptionCatalog = async (req, res) => {
  try {
    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const rosterCount = await countRosterActiveStudents(user.schoolId);
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);

    const base = await loadSubscriptionStripeCatalogPrices(includedSeatCount);

    return res.json({
      data: {
        stripeConfigured: base.stripeConfigured,
        product: base.product,
        prices: base.prices,
        activeStudentCount: rosterCount,
        includedSeatStudentCount: includedSeatCount,
      },
    });
  } catch (err) {
    console.error("getSubscriptionCatalog:", err);
    return res.status(500).json({ message: err.message || "Failed to load catalog" });
  }
};

/**
 * GET /api/subscription/status — school_admin
 */
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const billing = await getBillingSettingsDoc();
    const school = await School.findById(user.schoolId)
      .select("name email verificationStatus verifiedAt createdAt")
      .lean();
    const trialAccess = await getSchoolBillingAccess(user.schoolId, { school });

    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();

    const rosterCount = await countRosterActiveStudents(user.schoolId);
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);

    const plan = sub?.plan || null;
    const statusOut = sub?.status ?? null;
    const currentPeriodStart = sub?.currentPeriodStart;
    const currentPeriodEnd = sub?.currentPeriodEnd;
    const graceEndsAt = sub?.graceEndsAt;
    const lastPaymentAt = sub?.lastPaymentAt;
    const billingMode = sub?.billingMode || null;

    const amountPaise =
      plan && ["monthly", "quarterly", "yearly"].includes(plan)
        ? planAmountPaise(plan, includedSeatCount, billing.pricePerStudentYearInr)
        : null;

    // Quote all cadences whenever we have a student count so checkout cards can show prices
    // before the school has chosen a plan (plan null / status none).
    const amountsInr =
      includedSeatCount >= 1
        ? {
            monthly: planAmountPaise("monthly", includedSeatCount, billing.pricePerStudentYearInr) / 100,
            quarterly:
              planAmountPaise("quarterly", includedSeatCount, billing.pricePerStudentYearInr) / 100,
            yearly: planAmountPaise("yearly", includedSeatCount, billing.pricePerStudentYearInr) / 100,
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
        currentPeriodStart,
        currentPeriodEnd,
        graceEndsAt,
        adminUnblockUntil: sub?.adminUnblockUntil,
        lastPaymentAt,
        billingMode,
        stripeConfigured: isStripeConfigured(),
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

/**
 * POST /api/subscription/sync-student-count — school_admin (updates Stripe subscription item price)
 */
exports.syncStudentCountToStripe = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId });
    if (!sub?.stripeSubscriptionId) {
      return res.status(400).json({ message: "No active Stripe subscription to update" });
    }

    const billing = await getBillingSettingsDoc();
    const includedSeatCount = await countIncludedSeatStudents(user.schoolId);

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
      expand: ["items.data.price"],
    });
    const item = stripeSub.items.data[0];
    const itemId = item?.id;
    if (!itemId) {
      return res.status(500).json({ message: "Could not read subscription items" });
    }

    if (sub.billingMode === "per_seat") {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: itemId, quantity: includedSeatCount }],
        proration_behavior: "create_prorations",
      });

      sub.billedStudentCount = includedSeatCount;
      sub.pricePerStudentYearInr = billing.pricePerStudentYearInr;
      await sub.save();

      return res.json({
        message: "Subscription seat count updated in Stripe (prorations may apply)",
        data: { activeStudentCount: includedSeatCount, billingMode: "per_seat" },
      });
    }

    const plan = sub.plan;
    if (!plan || !["monthly", "quarterly", "yearly"].includes(plan)) {
      return res.status(400).json({ message: "Plan unknown — cannot sync legacy subscription" });
    }

    const amountPaise = planAmountPaise(plan, includedSeatCount, billing.pricePerStudentYearInr);
    const productId = stripeProductId();
    const recurring = stripeIntervalForPlan(plan);

    const newPrice = await stripe.prices.create({
      currency: "inr",
      unit_amount: amountPaise,
      recurring,
      product: productId,
      metadata: { schoolId: user.schoolId.toString(), plan, reason: "count_sync" },
    });

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPrice.id }],
      proration_behavior: "create_prorations",
    });

    sub.billedStudentCount = includedSeatCount;
    sub.pricePerStudentYearInr = billing.pricePerStudentYearInr;
    sub.stripePriceId = newPrice.id;
    await sub.save();

    return res.json({
      message: "Subscription updated for new student count (prorations may apply)",
      data: { activeStudentCount: includedSeatCount, amountPaise, billingMode: "dynamic_total" },
    });
  } catch (err) {
    console.error("syncStudentCountToStripe:", err);
    return res.status(500).json({ message: err.message || "Sync failed" });
  }
};

async function handleInvoicePaid(stripe, invoice, fallbackSchoolId) {
  const subId = invoice.subscription;
  if (!subId) return;

  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const schoolId = stripeSub.metadata?.schoolId || fallbackSchoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  // Paid invoice => paid subscription in good standing.
  subDoc.status = "active";
  subDoc.stripeSubscriptionId = stripeSub.id;
  const cust = stripeSub.customer;
  subDoc.stripeCustomerId = typeof cust === "string" ? cust : cust?.id;
  subDoc.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
  subDoc.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
  subDoc.lastPaymentAt = new Date();
  subDoc.graceStartedAt = undefined;
  subDoc.graceEndsAt = undefined;
  subDoc.graceReminderDay = undefined;
  subDoc.remindersSent = { preDue3: false, preDue2: false, preDue1: false };
  await subDoc.save();

}

async function handleInvoicePaymentFailed(stripe, invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const schoolId = stripeSub.metadata?.schoolId;
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
      text: `Your Utthan/Educa subscription payment did not go through. Staff and parent access is paused until payment succeeds. The school admin can update the payment method or complete payment from the school billing dashboard.`,
      logContext: "subscription_payment_failed",
    });
  }
}

async function handleSubscriptionUpdated(stripeSub, fallbackSchoolId) {
  const schoolId = stripeSub.metadata?.schoolId || fallbackSchoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

  if (stripeSub.status === "active" || stripeSub.status === "trialing") {
    subDoc.status = "active";
    subDoc.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
    subDoc.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
    subDoc.graceEndsAt = undefined;
    subDoc.graceStartedAt = undefined;
    subDoc.graceReminderDay = undefined;
  } else if (stripeSub.status === "past_due") {
    subDoc.status = "inactive";
    subDoc.graceStartedAt = undefined;
    subDoc.graceEndsAt = undefined;
    subDoc.graceReminderDay = undefined;
  } else if (stripeSub.status === "unpaid") {
    subDoc.status = "inactive";
    subDoc.graceStartedAt = undefined;
    subDoc.graceEndsAt = undefined;
    subDoc.graceReminderDay = undefined;
  } else if (stripeSub.status === "canceled") {
    subDoc.status = "inactive";
    subDoc.canceledAt = new Date();
  }

  subDoc.stripeSubscriptionId = stripeSub.id;
  const cust2 = stripeSub.customer;
  subDoc.stripeCustomerId = typeof cust2 === "string" ? cust2 : cust2?.id;

  const itemQty = stripeSub.items?.data?.[0]?.quantity;
  if (itemQty != null && subDoc.billingMode === "per_seat") {
    subDoc.billedStudentCount = itemQty;
  }

  await subDoc.save();
}

/**
 * POST /api/subscription/confirm-session — school_admin
 * Pulls Checkout + Subscription from Stripe and updates MongoDB. Use when returning from Checkout success
 * (especially local dev: Stripe cannot POST webhooks to localhost unless you use Stripe CLI forwarding).
 * body: { sessionId } from success URL ?session_id=cs_...
 */
exports.confirmCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe is not configured" });
    }

    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const schoolForTrial = await School.findById(user.schoolId)
      .select("verificationStatus verifiedAt createdAt")
      .lean();
    const trialAccess = await getSchoolBillingAccess(user.schoolId, { school: schoolForTrial });
    if (trialAccess.inTrial) {
      return res.status(403).json({
        message:
          "Your school is still in the free trial. Subscription checkout is not available until the trial ends.",
        code: "TRIAL_ACTIVE_NO_CHECKOUT",
      });
    }

    const { sessionId } = req.body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.latest_invoice"],
    });

    if (session.mode !== "subscription") {
      return res.status(400).json({ message: "Not a subscription checkout" });
    }

    const subRef = session.subscription;
    if (!subRef) {
      return res.status(400).json({ message: "Subscription not available on this session yet" });
    }

    const stripeSub =
      typeof subRef === "string"
        ? await stripe.subscriptions.retrieve(subRef, { expand: ["latest_invoice"] })
        : subRef;

    const userSchoolId = String(user.schoolId);
    const sessionSchoolId = session.metadata?.schoolId ? String(session.metadata.schoolId) : null;
    const subSchoolId = stripeSub.metadata?.schoolId ? String(stripeSub.metadata.schoolId) : null;
    const resolvedSchoolId = sessionSchoolId || subSchoolId;
    if (!resolvedSchoolId || resolvedSchoolId !== userSchoolId) {
      return res.status(403).json({ message: "This checkout session does not belong to your school" });
    }

    if (session.payment_status === "paid") {
      const li = stripeSub.latest_invoice;
      if (li) {
        const inv = typeof li === "string" ? await stripe.invoices.retrieve(li) : li;
        if (inv?.status === "paid" && inv.subscription) {
          await handleInvoicePaid(stripe, inv, resolvedSchoolId);
        }
      }
    }

    await handleSubscriptionUpdated(stripeSub, resolvedSchoolId);

    const refreshed = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();
    return res.json({
      message: "Synced from Stripe",
      data: {
        status: subscriptionStatusForClient(refreshed?.status),
        stripeSubscriptionId: refreshed?.stripeSubscriptionId,
        currentPeriodEnd: refreshed?.currentPeriodEnd,
      },
    });
  } catch (err) {
    console.error("confirmCheckoutSession:", err);
    return res.status(500).json({ message: err.message || "Could not confirm checkout session" });
  }
};

/**
 * One-time Checkout for pending student activations (mode=payment).
 * Idempotent: duplicate webhooks get modifiedCount 0 on Student.updateMany.
 * Aligns billedStudentCount and (for per_seat) Stripe subscription quantity without extra proration
 * (the Checkout payment already covered the prorated amount).
 */
async function handlePendingStudentsCheckoutCompleted(session) {
  const meta = session.metadata || {};
  if (meta.type !== "pending_students") return;
  const schoolIdRaw = meta.school_id || meta.schoolId;
  if (!schoolIdRaw) return;
  if (session.payment_status !== "paid") return;

  const schoolId = new mongoose.Types.ObjectId(String(schoolIdRaw));

  // Fetch pending students before activation so we can read their stored credentials.
  const pendingStudents = await Student.find(
    { schoolId, status: "pending" },
    { _id: 1, name: 1, "pendingCredentialsSms.phone": 1, "pendingCredentialsSms.message": 1 }
  ).lean();

  const result = await Student.updateMany(
    { schoolId, status: "pending" },
    {
      $set: { status: "active", seatBillingStatus: "included" },
      $unset: { pendingCredentialsSms: "" },
    }
  );

  if (result.modifiedCount === 0) return;

  // Send deferred SMS credentials to each newly activated student's parent.
  for (const s of pendingStudents) {
    const phone = s.pendingCredentialsSms?.phone;
    const message = s.pendingCredentialsSms?.message;
    if (phone && message) {
      sendSms(phone, message).catch((err) =>
        console.error(`Failed to send activation SMS for student ${s._id}:`, err.message)
      );
    }
  }

  const schoolIdStr = String(schoolIdRaw);
  const includedSeatCount = await countIncludedSeatStudents(schoolIdStr);

  await SchoolSubscription.updateOne(
    { schoolId: schoolIdStr },
    { $set: { billedStudentCount: includedSeatCount } }
  );

  const stripe = getStripe();
  const subDoc = await SchoolSubscription.findOne({ schoolId: schoolIdStr });
  if (stripe && subDoc?.stripeSubscriptionId && subDoc.billingMode === "per_seat") {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subDoc.stripeSubscriptionId);
      const itemId = stripeSub.items.data[0]?.id;
      if (itemId) {
        await stripe.subscriptions.update(subDoc.stripeSubscriptionId, {
          items: [{ id: itemId, quantity: includedSeatCount }],
          proration_behavior: "none",
        });
      }
    } catch (e) {
      console.error("pending_students Stripe quantity sync:", e);
    }
  }
}

/**
 * GET /api/subscription/pending-students-activation-quote
 */
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
 * POST /api/schools/:id/create-pending-checkout
 * India Stripe + INR: non-Indian test cards (e.g. 4242…) are treated as international and fail without export
 * onboarding; use test Visa 4000003560000008. @see https://docs.stripe.com/testing#international-cards
 */
exports.createPendingStudentsCheckout = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe is not configured (STRIPE_SECRET_KEY)" });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Only school administrators can checkout" });
    }

    const paramId = req.params.id;
    if (!paramId || String(user.schoolId) !== String(paramId)) {
      return res.status(403).json({ message: "You can only checkout for your own school" });
    }

    const schoolId = user.schoolId;
    const school = await School.findById(schoolId);
    if (!school || school.verificationStatus !== "Verified") {
      return res.status(403).json({ message: "School must be verified before paying" });
    }

    if (!schoolHasStripeExportAddress(school)) {
      return res.status(400).json({
        message:
          "Complete your school profile (name, address line 1, city, PIN code) before paying. Stripe requires this for India export compliance.",
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
    let amountInr = Math.max(1, resolvedInr);
    const unitAmountPaise = Math.max(50, Math.round(amountInr * 100));

    const productId = stripeProductId();
    if (!productId) {
      return res.status(503).json({
        message: "Missing STRIPE_PRODUCT_ID — use the same Product as subscription checkout",
      });
    }

    const customerId = await ensureStripeCustomerForSchoolCheckout(stripe, subDoc, school);

    const base = webAppBase();
    const sessionConfig = {
      mode: "payment",
      customer: customerId,
      // Same catalog Product as subscription (recurring prices) so Checkout settles as domestic INR like /subscription.
      locale: "en",
      line_items: [
        {
          price_data: {
            currency: "inr",
            product: productId,
            unit_amount: unitAmountPaise,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "pending_students",
        school_id: school._id.toString(),
        schoolId: school._id.toString(),
      },
      // Statement / PI description (also used for India export reporting when the payer is non-IN).
      payment_intent_data: {
        description: `Student seat activation, prorated (${pendingCount} seat(s)) — ${school.name}`,
        metadata: {
          type: "pending_students",
          school_id: school._id.toString(),
          schoolId: school._id.toString(),
        },
      },
      success_url: `${base}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/payment-cancel`,
    };

    applyStripeCheckoutBillingAndPayments(sessionConfig);

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionConfig);
    } catch (firstErr) {
      const msg = String(firstErr?.message || "");
      if (
        sessionConfig.automatic_payment_methods &&
        (msg.includes("automatic_payment_methods") || firstErr?.param === "automatic_payment_methods")
      ) {
        delete sessionConfig.automatic_payment_methods;
        session = await stripe.checkout.sessions.create(sessionConfig);
      } else {
        throw firstErr;
      }
    }

    if (!subDoc.stripeCustomerId) {
      subDoc.stripeCustomerId = customerId;
      await subDoc.save();
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error("createPendingStudentsCheckout:", err);
    return res.status(500).json({ message: err.message || "Could not create checkout session" });
  }
};

/**
 * Raw body webhook — mounted separately in server.js
 */
exports.handleStripeWebhook = async (req, res) => {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !whSecret) {
    return res.status(503).send("Stripe webhook not configured");
  }

  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error("Webhook signature:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(stripe, event.data.object, null);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(stripe, event.data.object);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionUpdated(event.data.object, null);
        break;
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "payment" && session.metadata?.type === "pending_students") {
          await handlePendingStudentsCheckoutCompleted(session);
          break;
        }
        if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const stripeSub = await stripe.subscriptions.retrieve(subId);
          await handleSubscriptionUpdated(stripeSub, session.metadata?.schoolId);
          const schoolId = session.metadata?.schoolId;
          if (schoolId) {
            const subDoc = await SchoolSubscription.findOne({ schoolId });
            if (subDoc) {
              const sc = session.customer;
              subDoc.stripeCustomerId = typeof sc === "string" ? sc : sc?.id;
              subDoc.stripeSubscriptionId = subId;
              await subDoc.save();
            }
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({ received: false });
  }

  res.json({ received: true });
};

/** Used by cron — pre-renewal reminders only (no grace period). */
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

/**
 * Used by cron — converts school trial rows to inactive once school trial window ends.
 * This is an explicit DB sync so status is visible in Mongo even before any API read.
 */
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
