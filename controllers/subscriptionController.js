const mongoose = require("mongoose");
const Stripe = require("stripe");
const School = require("../models/School");
const Student = require("../models/Student");
const SchoolSubscription = require("../models/SchoolSubscription");
const BillingSettings = require("../models/BillingSettings");
const { planAmountPaise, stripeIntervalForPlan } = require("../utils/subscriptionPricing");
const { sendMail } = require("../utils/mail");

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
      gracePeriodDays: Number(process.env.SUBSCRIPTION_GRACE_DAYS) || 3,
    });
  }
  return b;
}

async function countActiveStudents(schoolId) {
  return Student.countDocuments({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    status: "active",
  });
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
 * POST /api/subscription/checkout — school_admin
 * body: { priceId: string } — must be an active recurring price on STRIPE_PRODUCT_ID (per-seat unit × student count).
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
    const studentCount = await countActiveStudents(school._id);
    if (studentCount < 1) {
      return res.status(400).json({ message: "Add at least one active student before subscribing" });
    }

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
        status: "incomplete",
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
      billing_address_collection: "required",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      metadata: {
        schoolId: school._id.toString(),
        plan,
        stripePriceId: priceId,
        mongoSubscriptionId: subDoc._id.toString(),
      },
      subscription_data: {
        metadata: {
          schoolId: school._id.toString(),
          plan,
          stripePriceId: priceId,
        },
      },
    };

    // Customer.name is already set to the school name; billing_address_collection handles address.
    // We do not use name_collection here — extra "business name" fields are redundant for schools.

    const session = await stripe.checkout.sessions.create(sessionConfig);

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
 * GET /api/subscription/catalog — Stripe product + recurring INR prices (school_admin)
 */
exports.getSubscriptionCatalog = async (req, res) => {
  try {
    const user = await require("../models/User").findById(req.user.id);
    if (!user || user.role !== "school_admin" || !user.schoolId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const studentCount = await countActiveStudents(user.schoolId);

    if (!isStripeConfigured()) {
      return res.json({
        data: {
          stripeConfigured: false,
          product: null,
          prices: [],
          activeStudentCount: studentCount,
        },
      });
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
          totalForSchoolInr: studentCount >= 1 ? (unitMinor * studentCount) / 100 : null,
        };
      });

    return res.json({
      data: {
        stripeConfigured: true,
        product: {
          id: product.id,
          name: product.name,
          description: product.description || null,
        },
        prices,
        activeStudentCount: studentCount,
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
    const studentCount = await countActiveStudents(user.schoolId);
    const sub = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();
    const school = await School.findById(user.schoolId).select("name email").lean();

    const plan = sub?.plan || null;
    const amountPaise =
      plan && ["monthly", "quarterly", "yearly"].includes(plan)
        ? planAmountPaise(plan, studentCount, billing.pricePerStudentYearInr)
        : null;

    // Quote all cadences whenever we have a student count so checkout cards can show prices
    // before the school has chosen a plan (plan null / status none).
    const amountsInr =
      studentCount >= 1
        ? {
            monthly: planAmountPaise("monthly", studentCount, billing.pricePerStudentYearInr) / 100,
            quarterly: planAmountPaise("quarterly", studentCount, billing.pricePerStudentYearInr) / 100,
            yearly: planAmountPaise("yearly", studentCount, billing.pricePerStudentYearInr) / 100,
          }
        : null;

    return res.json({
      data: {
        school: { name: school?.name, email: school?.email },
        activeStudentCount: studentCount,
        pricePerStudentYearInr: billing.pricePerStudentYearInr,
        plan,
        amountsInr,
        currentPeriodAmountInr: amountPaise != null ? amountPaise / 100 : null,
        status: sub?.status || "none",
        currentPeriodStart: sub?.currentPeriodStart,
        currentPeriodEnd: sub?.currentPeriodEnd,
        graceEndsAt: sub?.graceEndsAt,
        adminUnblockUntil: sub?.adminUnblockUntil,
        lastPaymentAt: sub?.lastPaymentAt,
        billingMode: sub?.billingMode || null,
        stripeConfigured: isStripeConfigured(),
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
    const studentCount = await countActiveStudents(user.schoolId);

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
        items: [{ id: itemId, quantity: studentCount }],
        proration_behavior: "create_prorations",
      });

      sub.billedStudentCount = studentCount;
      sub.pricePerStudentYearInr = billing.pricePerStudentYearInr;
      await sub.save();

      return res.json({
        message: "Subscription seat count updated in Stripe (prorations may apply)",
        data: { activeStudentCount: studentCount, billingMode: "per_seat" },
      });
    }

    const plan = sub.plan;
    if (!plan || !["monthly", "quarterly", "yearly"].includes(plan)) {
      return res.status(400).json({ message: "Plan unknown — cannot sync legacy subscription" });
    }

    const amountPaise = planAmountPaise(plan, studentCount, billing.pricePerStudentYearInr);
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

    sub.billedStudentCount = studentCount;
    sub.pricePerStudentYearInr = billing.pricePerStudentYearInr;
    sub.stripePriceId = newPrice.id;
    await sub.save();

    return res.json({
      message: "Subscription updated for new student count (prorations may apply)",
      data: { activeStudentCount: studentCount, amountPaise, billingMode: "dynamic_total" },
    });
  } catch (err) {
    console.error("syncStudentCountToStripe:", err);
    return res.status(500).json({ message: err.message || "Sync failed" });
  }
};

async function applyGraceIfNeeded(subDoc, billing) {
  if (
    subDoc.status === "grace" &&
    subDoc.graceEndsAt &&
    new Date(subDoc.graceEndsAt) > new Date()
  ) {
    return;
  }
  const days = billing.gracePeriodDays ?? 3;
  subDoc.status = "grace";
  subDoc.graceStartedAt = new Date();
  subDoc.graceEndsAt = new Date(Date.now() + days * 86400000);
  await subDoc.save();
}

async function handleInvoicePaid(stripe, invoice, fallbackSchoolId) {
  const subId = invoice.subscription;
  if (!subId) return;

  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const schoolId = stripeSub.metadata?.schoolId || fallbackSchoolId;
  if (!schoolId) return;

  const subDoc = await SchoolSubscription.findOne({ schoolId });
  if (!subDoc) return;

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

  const billing = await getBillingSettingsDoc();
  await applyGraceIfNeeded(subDoc, billing);

  const school = await School.findById(schoolId).select("email name").lean();
  if (school?.email) {
    await sendMail({
      to: school.email,
      subject: "Payment failed — please update your subscription",
      text: `Your Utthan/Educa subscription payment did not go through. You have a ${billing.gracePeriodDays}-day grace period before access is suspended. Please update your payment method in the billing portal or complete payment from your school dashboard.`,
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
  } else if (stripeSub.status === "past_due") {
    const billing = await getBillingSettingsDoc();
    if (!subDoc.graceEndsAt || new Date(subDoc.graceEndsAt) <= new Date()) {
      await applyGraceIfNeeded(subDoc, billing);
    }
  } else if (stripeSub.status === "unpaid") {
    subDoc.status = "suspended";
  } else if (stripeSub.status === "canceled") {
    subDoc.status = "canceled";
    subDoc.canceledAt = new Date();
  }

  subDoc.stripeSubscriptionId = stripeSub.id;
  const cust2 = stripeSub.customer;
  subDoc.stripeCustomerId = typeof cust2 === "string" ? cust2 : cust2?.id;
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

    const { sessionId } = req.body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.latest_invoice"],
    });

    const metaSchool = session.metadata?.schoolId;
    if (!metaSchool || metaSchool !== String(user.schoolId)) {
      return res.status(403).json({ message: "This checkout session does not belong to your school" });
    }

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

    if (session.payment_status === "paid") {
      const li = stripeSub.latest_invoice;
      if (li) {
        const inv = typeof li === "string" ? await stripe.invoices.retrieve(li) : li;
        if (inv?.status === "paid" && inv.subscription) {
          await handleInvoicePaid(stripe, inv, metaSchool);
        }
      }
    }

    await handleSubscriptionUpdated(stripeSub, metaSchool);

    const refreshed = await SchoolSubscription.findOne({ schoolId: user.schoolId }).lean();
    return res.json({
      message: "Synced from Stripe",
      data: {
        status: refreshed?.status,
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

/** Used by cron */
exports.runReminderAndGraceJobs = async () => {
  const stripe = getStripe();
  const subs = await SchoolSubscription.find({
    $or: [{ status: "active", currentPeriodEnd: { $ne: null } }, { status: "grace" }],
  });

  const now = new Date();
  const dayMs = 86400000;

  for (const sub of subs) {
    const school = await School.findById(sub.schoolId).select("email name").lean();
    if (!school?.email) continue;

    const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    if (end && sub.status === "active") {
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

    if (sub.status === "grace" && sub.graceEndsAt) {
      if (new Date(sub.graceEndsAt) <= now) {
        sub.status = "suspended";
        await sub.save();
        if (stripe && sub.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
          } catch (e) {
            console.warn("Stripe cancel after suspend:", e.message);
          }
        }
      } else {
        const dayKey = now.toISOString().slice(0, 10);
        if (sub.graceReminderDay !== dayKey) {
          sub.graceReminderDay = dayKey;
          await sub.save();
          await sendMail({
            to: school.email,
            subject: "Payment overdue — grace period",
            text: `Your payment is overdue. Please pay before ${new Date(sub.graceEndsAt).toDateString()} to avoid service interruption.`,
            logContext: "sub_grace_daily",
          });
        }
      }
    }
  }
};
