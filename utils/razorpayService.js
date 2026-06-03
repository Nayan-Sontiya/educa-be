const crypto = require("crypto");
const Razorpay = require("razorpay");
const { planAmountPaise, razorpayIntervalForPlan } = require("./subscriptionPricing");

const PLAN_KEYS = ["monthly", "quarterly", "yearly"];

/** UtthanAI Razorpay Dashboard plans (override via RAZORPAY_PLAN_*_ID env). */
const DEFAULT_RAZORPAY_PLAN_IDS = {
  monthly: "plan_SxENzCjfGpbGus",
  quarterly: "plan_SxENZseE1OcEEe",
  yearly: "plan_SxEOmKaHzwrWZU",
};

/** Cache Razorpay plan list (same idea as live Stripe price list). */
const PLAN_SYNC_TTL_MS = Number(process.env.RAZORPAY_PLAN_SYNC_TTL_MS) || 120000;
let _planSyncCache = { at: 0, byPlan: null };

function razorpayKeyId() {
  const k = process.env.RAZORPAY_KEY_ID;
  return typeof k === "string" ? k.trim() : "";
}

function razorpayKeySecret() {
  const k = process.env.RAZORPAY_KEY_SECRET;
  return typeof k === "string" ? k.trim() : "";
}

function webhookSecret() {
  return (
    process.env.WEBHOOK_SECRET ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    ""
  ).trim();
}

function isRazorpayConfigured() {
  return Boolean(razorpayKeyId() && razorpayKeySecret());
}

/** Razorpay Unix bounds for end_at / end_time (seconds, NOT milliseconds). */
const RAZORPAY_MAX_END_AT_SEC = 4765046400;
const RAZORPAY_MIN_END_AT_SEC = 946684800;
const RAZORPAY_ABSOLUTE_MAX_TOTAL_COUNT = 1200;
/** UPI Autopay / QR mandate: expire_at cannot be more than 30 years from start. */
const UPI_MANDATE_MAX_YEARS = 30;
/** Customer must complete mandate auth within this window (seconds). */
const SUBSCRIPTION_AUTH_EXPIRE_SEC = 30 * 60;
const END_AT_BUFFER_SEC = 86400;

function addOneBillingCycle(date, plan) {
  const d = new Date(date.getTime());
  const { period, interval } = razorpayIntervalForPlan(plan);
  const step = interval || 1;
  if (period === "yearly") {
    d.setFullYear(d.getFullYear() + step);
  } else {
    d.setMonth(d.getMonth() + step);
  }
  return d;
}

/**
 * Latest allowed subscription end (seconds) for Standard Checkout with UPI.
 * Stricter of: Razorpay global end_at cap (~year 2121) and UPI mandate 30-year limit.
 */
function maxEndAtSecForCheckout(startAtSec = Math.floor(Date.now() / 1000)) {
  const start = new Date(startAtSec * 1000);
  const upiLimit = new Date(start);
  upiLimit.setFullYear(upiLimit.getFullYear() + UPI_MANDATE_MAX_YEARS);
  const upiLimitSec = Math.floor(upiLimit.getTime() / 1000) - END_AT_BUFFER_SEC;
  const globalCapSec = RAZORPAY_MAX_END_AT_SEC - END_AT_BUFFER_SEC;
  return Math.min(globalCapSec, upiLimitSec);
}

/**
 * Max billing cycles using calendar month/year steps (Razorpay's model).
 * Capped for UPI QR ("expire_at cannot be more than 30 years for upi") and global end_at.
 */
function maxTotalCountForPlan(plan, startAtSec = Math.floor(Date.now() / 1000)) {
  const start = new Date(startAtSec * 1000);
  const maxEndSec = maxEndAtSecForCheckout(startAtSec);
  let count = 0;
  let cursor = start;
  while (count < RAZORPAY_ABSOLUTE_MAX_TOTAL_COUNT) {
    const next = addOneBillingCycle(cursor, plan);
    const nextSec = Math.floor(next.getTime() / 1000);
    if (nextSec > maxEndSec) break;
    count += 1;
    cursor = next;
  }
  return Math.max(1, count);
}

function isEndAtWithinRazorpayBounds(endAtSec, startAtSec = Math.floor(Date.now() / 1000)) {
  if (endAtSec == null || endAtSec === "") return true;
  const n = Number(endAtSec);
  if (!Number.isFinite(n)) return false;
  if (n > 1e12) return false;
  return n >= RAZORPAY_MIN_END_AT_SEC && n <= maxEndAtSecForCheckout(startAtSec);
}

/**
 * Razorpay requires total_count >= 1 when end_at is omitted.
 * Capped per plan so subscription end_at (and Checkout UPI QR end_time) stay valid.
 */
function subscriptionTotalCount(plan, startAtSec = Math.floor(Date.now() / 1000)) {
  const envN = Number(process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT);
  const requested =
    Number.isFinite(envN) && envN >= 1
      ? Math.min(RAZORPAY_ABSOLUTE_MAX_TOTAL_COUNT, Math.floor(envN))
      : RAZORPAY_ABSOLUTE_MAX_TOTAL_COUNT;
  const capped = maxTotalCountForPlan(plan, startAtSec);
  if (requested > capped) {
    console.warn(
      `[razorpay] RAZORPAY_SUBSCRIPTION_TOTAL_COUNT=${requested} too high for plan "${plan}" ` +
        `(max ${capped} before end_at cap) — using ${capped}`,
    );
  }
  return Math.min(requested, capped);
}

let _client = null;

function getRazorpay() {
  if (!isRazorpayConfigured()) return null;
  if (!_client) {
    _client = new Razorpay({
      key_id: razorpayKeyId(),
      key_secret: razorpayKeySecret(),
    });
  }
  return _client;
}

function envPlanId(plan) {
  const key = `RAZORPAY_PLAN_${String(plan).toUpperCase()}_ID`;
  const fromEnv = process.env[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_RAZORPAY_PLAN_IDS[plan] || "";
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return expected === signature;
}

function verifySubscriptionPaymentSignature({
  razorpay_payment_id,
  razorpay_subscription_id,
  razorpay_signature,
}) {
  const secret = razorpayKeySecret();
  if (!secret || !razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return false;
  }
  const payload = `${razorpay_payment_id}|${razorpay_subscription_id}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return expected === razorpay_signature;
}

function verifyOrderPaymentSignature({
  razorpay_payment_id,
  razorpay_order_id,
  razorpay_signature,
}) {
  const secret = razorpayKeySecret();
  if (!secret || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return false;
  }
  const payload = `${razorpay_payment_id}|${razorpay_order_id}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return expected === razorpay_signature;
}

function planDisplayMeta(plan) {
  if (plan === "monthly") return { intervalLabel: "per month", period: "monthly", interval: 1 };
  if (plan === "quarterly") return { intervalLabel: "per quarter", period: "monthly", interval: 3 };
  if (plan === "yearly") return { intervalLabel: "per year", period: "yearly", interval: 1 };
  return { intervalLabel: "per period", period: "monthly", interval: 1 };
}

function razorpayErrorMessage(err) {
  return (
    err?.error?.description ||
    err?.error?.reason ||
    err?.message ||
    String(err || "Unknown Razorpay error")
  );
}

async function fetchRazorpayPlan(planId) {
  const rzp = getRazorpay();
  if (!rzp || !planId) return null;
  try {
    return await rzp.plans.fetch(planId);
  } catch (err) {
    console.error(`[razorpay] plans.fetch(${planId}):`, razorpayErrorMessage(err));
    return null;
  }
}

function invalidateRazorpayPlanCache() {
  _planSyncCache = { at: 0, byPlan: null };
}

/**
 * Map a Razorpay plan to monthly | quarterly | yearly.
 * Priority: notes.plan → item name keywords → period + interval.
 */
function inferPlanKeyFromRazorpayPlan(rzpPlan) {
  if (!rzpPlan) return null;

  const notes = rzpPlan.notes || {};
  const notePlan = String(notes.plan || notes.cadence || notes.billing_plan || "")
    .trim()
    .toLowerCase();
  if (PLAN_KEYS.includes(notePlan)) return notePlan;

  const name = String(rzpPlan.item?.name || "").toLowerCase();
  if (/\bmonthly\b/.test(name) && !/\bquarter/.test(name)) return "monthly";
  if (/\bquarter/.test(name)) return "quarterly";
  if (/\b(yearly|annual)\b/.test(name)) return "yearly";

  const period = String(rzpPlan.period || "").toLowerCase();
  const interval = Number(rzpPlan.interval) || 1;
  if (period === "monthly" && interval === 1) return "monthly";
  if (period === "monthly" && interval === 3) return "quarterly";
  if (period === "yearly" && interval === 1) return "yearly";

  return null;
}

function intervalLabelFromRazorpayPlan(rzpPlan, fallbackPlan) {
  if (!rzpPlan) return planDisplayMeta(fallbackPlan).intervalLabel;
  const period = String(rzpPlan.period || "").toLowerCase();
  const ic = Number(rzpPlan.interval) || 1;
  if (period === "monthly" && ic === 1) return "per month";
  if (period === "monthly" && ic === 3) return "per quarter";
  if (period === "yearly" && ic === 1) return "per year";
  if (ic === 1) return `per ${period}`;
  return `every ${ic} ${period}s`;
}

function planPreferScore(rzpPlan, planKey) {
  let score = 0;
  const notes = rzpPlan.notes || {};
  if (String(notes.plan || "").toLowerCase() === planKey) score += 100;
  if (String(rzpPlan.item?.name || "").toLowerCase().includes(planKey)) score += 10;
  if (String(rzpPlan.id || "").length) score += 1;
  return score;
}

/** Paginate GET /plans — all INR recurring plans on the Razorpay account. */
async function fetchAllRazorpayPlansFromApi() {
  const rzp = getRazorpay();
  if (!rzp) return [];

  const all = [];
  let skip = 0;
  const pageSize = 100;

  for (;;) {
    const page = await rzp.plans.all({ count: pageSize, skip });
    const items = page?.items || [];
    all.push(...items);
    if (items.length < pageSize) break;
    skip += pageSize;
    if (skip > 500) break;
  }

  return all.filter((p) => {
    const cur = String(p?.item?.currency || "INR").toUpperCase();
    return cur === "INR" && p?.item?.amount != null && Number(p.item.amount) >= 1;
  });
}

/**
 * Sync monthly / quarterly / yearly from Razorpay Dashboard (like Stripe catalog fetch).
 * Env RAZORPAY_PLAN_*_ID overrides auto-match when set.
 *
 * @returns {Promise<Map<string, object>>} plan key → Razorpay plan entity
 */
async function syncRazorpayPlansByCadence({ force = false } = {}) {
  if (
    !force &&
    _planSyncCache.byPlan &&
    Date.now() - _planSyncCache.at < PLAN_SYNC_TTL_MS
  ) {
    return _planSyncCache.byPlan;
  }

  const map = new Map();

  // 1) Env-configured plan IDs always win (never show stale auto-matched plans).
  for (const planKey of PLAN_KEYS) {
    const envId = envPlanId(planKey);
    if (!envId) continue;
    const fetched = await fetchRazorpayPlan(envId);
    if (fetched?.id) {
      map.set(planKey, fetched);
    }
  }

  // 2) Only fill cadences still missing after env fetch.
  const missingKeys = PLAN_KEYS.filter((k) => !map.has(k));
  if (missingKeys.length > 0) {
    try {
      const allPlans = await fetchAllRazorpayPlansFromApi();
      for (const rzpPlan of allPlans) {
        const key = inferPlanKeyFromRazorpayPlan(rzpPlan);
        if (!key || !missingKeys.includes(key) || map.has(key)) continue;

        const existing = map.get(key);
        if (!existing || planPreferScore(rzpPlan, key) > planPreferScore(existing, key)) {
          map.set(key, rzpPlan);
        }
      }
    } catch (err) {
      console.error("[razorpay] syncRazorpayPlansByCadence:", razorpayErrorMessage(err));
    }
  }

  _planSyncCache = { at: Date.now(), byPlan: map };
  return map;
}

function planSourceForCatalog(planKey, rzpPlan) {
  if (!rzpPlan) return "computed";
  if (envPlanId(planKey) && rzpPlan.id === envPlanId(planKey)) return "env";
  return "razorpay_dashboard";
}

/**
 * Create a Razorpay plan for per-seat billing (unit amount = one student for the period).
 */
async function createRazorpayPlan(plan, pricePerStudentYearInr) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");

  const { period, interval } = razorpayIntervalForPlan(plan);
  const unitPaise = planAmountPaise(plan, 1, pricePerStudentYearInr);
  const meta = planDisplayMeta(plan);

  const created = await rzp.plans.create({
    period,
    interval,
    item: {
      name: `UtthanAI school subscription — ${plan}`,
      amount: unitPaise,
      currency: "INR",
      description: `Per included student seat, billed ${meta.intervalLabel}`,
    },
    notes: { plan, billingUnit: "per_seat" },
  });

  return created;
}

async function resolvePlanId(plan, pricePerStudentYearInr) {
  const configuredId = envPlanId(plan);
  if (configuredId) {
    const fromEnv = await fetchRazorpayPlan(configuredId);
    if (fromEnv?.id) return fromEnv.id;
    console.warn(
      `[razorpay] Plan ${configuredId} for "${plan}" not found in Razorpay — check keys match this account.`,
    );
  }

  const synced = await syncRazorpayPlansByCadence();
  const fromDashboard = synced.get(plan);
  if (fromDashboard?.id) return fromDashboard.id;

  const created = await createRazorpayPlan(plan, pricePerStudentYearInr);
  console.warn(
    `[razorpay] No dashboard plan matched "${plan}" — created ${created.id}. ` +
      `Add notes.plan="${plan}" on your Razorpay plan, or set RAZORPAY_PLAN_${plan.toUpperCase()}_ID=${created.id}.`
  );
  synced.set(plan, created);
  _planSyncCache = { at: Date.now(), byPlan: synced };
  return created.id;
}

/**
 * Catalog rows for monthly / quarterly / yearly (per-seat unit amounts).
 */
async function loadSubscriptionCatalogPrices(
  includedSeatCount,
  pricePerStudentYearInr,
  { force = false } = {}
) {
  if (!isRazorpayConfigured()) {
    return {
      razorpayConfigured: false,
      plansSyncedFromDashboard: false,
      product: null,
      prices: [],
      planWarnings: [],
    };
  }

  const synced = await syncRazorpayPlansByCadence({ force });
  const prices = [];
  const planWarnings = [];
  let dashboardMatchCount = 0;

  for (const plan of PLAN_KEYS) {
    const configuredId = envPlanId(plan);
    const fallbackPaise = planAmountPaise(plan, 1, pricePerStudentYearInr);
    const meta = planDisplayMeta(plan);
    const razorpayPlan = synced.get(plan) || null;

    if (razorpayPlan?.id) dashboardMatchCount += 1;

    if (configuredId && razorpayPlan?.id !== configuredId) {
      planWarnings.push({
        plan,
        configuredRazorpayPlanId: configuredId,
        loadedRazorpayPlanId: razorpayPlan?.id || null,
        message: razorpayPlan
          ? `Loaded ${razorpayPlan.id} instead of configured ${configuredId}.`
          : `Could not load ${configuredId} from Razorpay. Check RAZORPAY_KEY_ID/SECRET and that plan mode (test vs live) matches your plan IDs.`,
      });
    }

    const unitMinor =
      razorpayPlan?.item?.amount != null ? Number(razorpayPlan.item.amount) : fallbackPaise;

    const intervalLabel = razorpayPlan
      ? intervalLabelFromRazorpayPlan(razorpayPlan, plan)
      : meta.intervalLabel;

    let planSource = "computed";
    if (razorpayPlan) {
      planSource = planSourceForCatalog(plan, razorpayPlan);
    } else if (configuredId) {
      planSource = "env_unavailable";
    }

    prices.push({
      id: razorpayPlan?.id || configuredId || plan,
      plan,
      nickname: razorpayPlan?.item?.name || `School plan — ${plan}`,
      currency: "inr",
      unitAmountMinor: unitMinor,
      unitAmountInr: unitMinor / 100,
      interval: razorpayPlan?.period || meta.period,
      intervalCount: razorpayPlan?.interval != null ? Number(razorpayPlan.interval) : meta.interval,
      intervalLabel,
      totalForSchoolInr:
        includedSeatCount >= 1 ? (unitMinor * includedSeatCount) / 100 : null,
      razorpayPlanId: razorpayPlan?.id || configuredId || null,
      planSource,
    });
  }

  return {
    razorpayConfigured: true,
    plansSyncedFromDashboard: dashboardMatchCount > 0,
    dashboardPlansMatched: dashboardMatchCount,
    planWarnings,
    product: {
      id: "utthan-school-subscription",
      name: "UtthanAI school subscription",
      description: "Per-seat billing for verified schools (INR)",
    },
    prices,
  };
}

function customerPayloadFromSchool(school) {
  const payload = {
    name: school.name.trim(),
    fail_existing: "0",
    notes: {
      schoolId: school._id.toString(),
      source: "educa_subscription",
    },
  };
  const em = school.email?.trim();
  if (em) payload.email = em;
  if (school.phone?.trim()) payload.contact = school.phone.trim();
  return payload;
}

function isDuplicateCustomerError(err) {
  const msg = String(err?.error?.description || err?.message || "").toLowerCase();
  return msg.includes("customer already exists");
}

/** Find existing Razorpay customer by email when create returns duplicate error. */
async function findRazorpayCustomerByEmail(email) {
  const rzp = getRazorpay();
  if (!rzp || !email?.trim()) return null;

  const target = email.trim().toLowerCase();
  let skip = 0;

  for (;;) {
    const page = await rzp.customers.all({ count: 100, skip });
    const items = page?.items || [];
    const hit = items.find((c) => String(c.email || "").trim().toLowerCase() === target);
    if (hit?.id) return hit;

    if (items.length < 100) break;
    skip += 100;
    if (skip > 500) break;
  }

  return null;
}

async function createOrReuseRazorpayCustomer(payload) {
  const rzp = getRazorpay();
  try {
    const customer = await rzp.customers.create(payload);
    return customer;
  } catch (err) {
    if (!isDuplicateCustomerError(err) || !payload.email) throw err;

    const existing = await findRazorpayCustomerByEmail(payload.email);
    if (existing?.id) return existing;

    throw err;
  }
}

async function ensureRazorpayCustomer(subDoc, school) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");

  const payload = customerPayloadFromSchool(school);

  if (subDoc.razorpayCustomerId) {
    try {
      await rzp.customers.edit(subDoc.razorpayCustomerId, payload);
      return subDoc.razorpayCustomerId;
    } catch (editErr) {
      console.warn(
        "[razorpay] customers.edit failed, re-resolving customer:",
        editErr?.error?.description || editErr?.message
      );
    }
  }

  const customer = await createOrReuseRazorpayCustomer(payload);
  return customer.id;
}

/**
 * Create Razorpay subscription (status: created). Frontend opens Checkout with subscription_id.
 */
async function createSchoolSubscription({
  plan,
  planId,
  quantity,
  customerId,
  schoolId,
  mongoSubscriptionId,
}) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");

  const startAtSec = Math.floor(Date.now() / 1000);
  const expireBySec = startAtSec + SUBSCRIPTION_AUTH_EXPIRE_SEC;
  let totalCount = subscriptionTotalCount(plan, startAtSec);

  const notes = {
    schoolId: String(schoolId),
    plan,
    mongoSubscriptionId: String(mongoSubscriptionId),
    billedSeatQuantity: String(quantity),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = {
      plan_id: planId,
      customer_id: customerId,
      quantity: Math.max(1, quantity),
      customer_notify: 1,
      total_count: totalCount,
      expire_by: expireBySec,
      notes,
    };

    const subscription = await rzp.subscriptions.create(payload);
    const rzEndAt = subscription?.end_at;

    if (isEndAtWithinRazorpayBounds(rzEndAt, startAtSec)) {
      return subscription;
    }

    console.warn(
      `[razorpay] subscription ${subscription?.id} end_at=${rzEndAt} out of bounds ` +
        `(total_count=${totalCount}, plan=${plan}) — retrying`,
    );
    try {
      await rzp.subscriptions.cancel(subscription.id, false);
    } catch (cancelErr) {
      console.warn("[razorpay] cancel invalid subscription:", cancelErr?.message || cancelErr);
    }
    totalCount = Math.max(1, Math.floor(totalCount * 0.7));
  }

  throw new Error(
    "Could not create a subscription within Razorpay date limits. Contact support.",
  );
}

async function fetchSubscription(subscriptionId) {
  const rzp = getRazorpay();
  if (!rzp || !subscriptionId) return null;
  return rzp.subscriptions.fetch(subscriptionId);
}

async function updateSubscriptionQuantity(subscriptionId, quantity) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");
  return rzp.subscriptions.update(subscriptionId, {
    quantity: Math.max(1, quantity),
    schedule_change_at: "now",
  });
}

async function cancelSubscription(subscriptionId, cancelAtCycleEnd = false) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");
  return rzp.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
}

async function createPendingStudentsOrder({ amountPaise, schoolId, pendingCount }) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");

  return rzp.orders.create({
    amount: Math.max(100, amountPaise),
    currency: "INR",
    receipt: `pending_${String(schoolId).slice(-8)}_${Date.now()}`,
    notes: {
      type: "pending_students",
      school_id: String(schoolId),
      schoolId: String(schoolId),
      pending_count: String(pendingCount),
    },
  });
}

/** One-time school plan payment (no UPI mandate / subscription). */
async function createSchoolPlanOrder({
  amountPaise,
  schoolId,
  plan,
  mongoSubscriptionId,
  seatCount,
}) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay is not configured");

  return rzp.orders.create({
    amount: Math.max(100, amountPaise),
    currency: "INR",
    receipt: `sub_${String(schoolId).slice(-8)}_${Date.now()}`,
    notes: {
      type: "school_plan",
      school_id: String(schoolId),
      schoolId: String(schoolId),
      plan,
      mongoSubscriptionId: String(mongoSubscriptionId),
      seat_count: String(seatCount),
    },
  });
}

async function fetchOrder(orderId) {
  const rzp = getRazorpay();
  if (!rzp || !orderId) return null;
  return rzp.orders.fetch(orderId);
}

function mapRazorpaySubscriptionStatus(rzpStatus) {
  const s = String(rzpStatus || "").toLowerCase();
  if (s === "active" || s === "authenticated") return "active";
  if (s === "created" || s === "pending") return "pending";
  return "inactive";
}

function periodBoundsFromRazorpaySubscription(rzpSub) {
  const startSec = rzpSub?.current_start;
  const endSec = rzpSub?.current_end;
  return {
    currentPeriodStart: startSec ? new Date(startSec * 1000) : undefined,
    currentPeriodEnd: endSec ? new Date(endSec * 1000) : undefined,
  };
}

module.exports = {
  PLAN_KEYS,
  razorpayKeyId,
  isRazorpayConfigured,
  getRazorpay,
  webhookSecret,
  verifyWebhookSignature,
  verifySubscriptionPaymentSignature,
  verifyOrderPaymentSignature,
  envPlanId,
  inferPlanKeyFromRazorpayPlan,
  syncRazorpayPlansByCadence,
  invalidateRazorpayPlanCache,
  resolvePlanId,
  loadSubscriptionCatalogPrices,
  ensureRazorpayCustomer,
  createSchoolSubscription,
  fetchSubscription,
  updateSubscriptionQuantity,
  cancelSubscription,
  createPendingStudentsOrder,
  createSchoolPlanOrder,
  fetchOrder,
  mapRazorpaySubscriptionStatus,
  periodBoundsFromRazorpaySubscription,
  fetchRazorpayPlan,
};
