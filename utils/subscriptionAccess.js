const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");
const BillingSettings = require("../models/BillingSettings");

/** Subscription states that allow access after the school-level free trial ends. */
const PAID_ACCESS_STATUSES = ["active", "trialing"];

function hasRazorpaySubscriptionId(sub) {
  return Boolean(sub?.razorpaySubscriptionId && String(sub.razorpaySubscriptionId).trim());
}

function envDefaultTrialWeeks() {
  const weeks = Number(process.env.SCHOOL_TRIAL_WEEKS);
  if (!Number.isFinite(weeks) || weeks < 0) return 4;
  return weeks;
}

async function loadGlobalBillingSettings() {
  let doc = await BillingSettings.findById("global").lean();
  if (!doc) {
    return {
      _id: "global",
      freeTrialEnabled: true,
      defaultTrialWeeks: envDefaultTrialWeeks(),
      pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
    };
  }
  return {
    ...doc,
    freeTrialEnabled: doc.freeTrialEnabled !== false,
    defaultTrialWeeks:
      doc.defaultTrialWeeks != null ? Number(doc.defaultTrialWeeks) : envDefaultTrialWeeks(),
  };
}

/**
 * Resolve when the school free trial ends (not subscription period end).
 * @param {object|null} school lean school with verifiedAt, freeTrialDisabled, trialEndsAtOverride
 * @param {object|null} billing global BillingSettings lean
 */
function computeTrialEndsAt(school, billing) {
  if (!school?.verifiedAt) return null;

  const verifiedAt = new Date(school.verifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return null;

  const globalTrialOff = billing?.freeTrialEnabled === false;
  const schoolTrialOff = Boolean(school.freeTrialDisabled);

  if (globalTrialOff || schoolTrialOff) {
    return verifiedAt;
  }

  if (school.trialEndsAtOverride) {
    const override = new Date(school.trialEndsAtOverride);
    if (!Number.isNaN(override.getTime())) return override;
  }

  const weeks =
    billing?.defaultTrialWeeks != null ? Number(billing.defaultTrialWeeks) : envDefaultTrialWeeks();
  if (!Number.isFinite(weeks) || weeks <= 0) {
    return verifiedAt;
  }

  return new Date(verifiedAt.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

/** @deprecated Use computeTrialEndsAt with billing settings */
function trialEndsAtFromSchool(school) {
  return computeTrialEndsAt(school, {
    freeTrialEnabled: true,
    defaultTrialWeeks: envDefaultTrialWeeks(),
  });
}

function trialDurationMs(billing) {
  const weeks =
    billing?.defaultTrialWeeks != null ? Number(billing.defaultTrialWeeks) : envDefaultTrialWeeks();
  if (!Number.isFinite(weeks) || weeks < 0) {
    return 4 * 7 * 24 * 60 * 60 * 1000;
  }
  return weeks * 7 * 24 * 60 * 60 * 1000;
}

/**
 * After school trial ended: only count a paid sub if it has a Razorpay id and billing
 * is anchored on/after school trial end (blocks legacy rows from test checkouts during trial).
 */
function subscriptionAnchoredAfterSchoolTrial(sub, trialEndsAtDate) {
  if (!sub || !trialEndsAtDate) return false;
  if (!PAID_ACCESS_STATUSES.includes(sub.status)) return false;
  if (!hasRazorpaySubscriptionId(sub)) return false;
  const trialEndMs = new Date(trialEndsAtDate).getTime();
  if (Number.isNaN(trialEndMs)) return false;
  const cps = sub.currentPeriodStart ? new Date(sub.currentPeriodStart).getTime() : NaN;
  const lpa = sub.lastPaymentAt ? new Date(sub.lastPaymentAt).getTime() : NaN;
  if (!Number.isNaN(cps) && cps >= trialEndMs) return true;
  if (!Number.isNaN(lpa) && lpa >= trialEndMs) return true;
  return false;
}

const SCHOOL_TRIAL_SELECT =
  "verificationStatus verifiedAt createdAt freeTrialDisabled trialEndsAtOverride";

async function loadSchoolForTrial(schoolId, partialSchool) {
  if (partialSchool && partialSchool.verificationStatus !== undefined) {
    return {
      freeTrialDisabled: false,
      trialEndsAtOverride: undefined,
      ...partialSchool,
    };
  }
  return School.findById(schoolId).select(SCHOOL_TRIAL_SELECT).lean();
}

/**
 * True if this school must be blocked from API/login (subscription suspended).
 */
async function isSchoolSubscriptionSuspended(schoolId) {
  if (!schoolId) return false;
  const sub = await SchoolSubscription.findOne({ schoolId }).lean();
  if (!sub) return false;
  if (sub.adminUnblockUntil && new Date(sub.adminUnblockUntil) > new Date()) {
    return false;
  }
  if (sub.status !== "inactive") return false;

  const school = await School.findById(schoolId).select(SCHOOL_TRIAL_SELECT).lean();
  if (!school || school.verificationStatus !== "Verified") {
    return false;
  }
  if (!school.verifiedAt) {
    return false;
  }

  const billing = await loadGlobalBillingSettings();
  const trialEndsAt = computeTrialEndsAt(school, billing);
  if (trialEndsAt && Date.now() <= trialEndsAt.getTime()) {
    return false;
  }

  return true;
}

/**
 * After a school is Verified, allow API access during free trial (unless disabled).
 * After trial, require paid subscription or admin unblock.
 */
async function getSchoolBillingAccess(schoolId, options = {}) {
  if (!schoolId) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
      freeTrialDisabled: false,
    };
  }

  const billing = options.billing || (await loadGlobalBillingSettings());
  let school = await loadSchoolForTrial(schoolId, options.school);

  if (!school) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
      freeTrialDisabled: false,
    };
  }
  if (school.verificationStatus !== "Verified") {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
      freeTrialDisabled: Boolean(school.freeTrialDisabled),
    };
  }

  if (!school.verifiedAt) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
      freeTrialDisabled: Boolean(school.freeTrialDisabled),
    };
  }

  const trialEndsAt = computeTrialEndsAt(school, billing);
  if (!trialEndsAt) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
      freeTrialDisabled: Boolean(school.freeTrialDisabled),
    };
  }

  const trialEndMs = trialEndsAt.getTime();
  const now = Date.now();
  const globalTrialOff = billing.freeTrialEnabled === false;
  const schoolTrialOff = Boolean(school.freeTrialDisabled);

  if (now <= trialEndMs && !globalTrialOff && !schoolTrialOff) {
    return {
      allowed: true,
      inTrial: true,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
      freeTrialDisabled: false,
    };
  }

  const sub = await SchoolSubscription.findOne({ schoolId }).lean();

  if (sub?.adminUnblockUntil && new Date(sub.adminUnblockUntil) > new Date()) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
      freeTrialDisabled: schoolTrialOff || globalTrialOff,
    };
  }

  if (subscriptionAnchoredAfterSchoolTrial(sub, trialEndsAt)) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
      freeTrialDisabled: schoolTrialOff || globalTrialOff,
    };
  }

  return {
    allowed: false,
    code: "TRIAL_EXPIRED_SUBSCRIPTION_REQUIRED",
    message:
      "Your school's subscription is not active. Please ask your school administrator to renew or subscribe.",
    inTrial: false,
    trialEndsAt: trialEndsAt.toISOString(),
    needsSubscription: true,
    freeTrialDisabled: schoolTrialOff || globalTrialOff,
  };
}

module.exports = {
  isSchoolSubscriptionSuspended,
  getSchoolBillingAccess,
  computeTrialEndsAt,
  trialEndsAtFromSchool,
  trialDurationMs,
  subscriptionAnchoredAfterSchoolTrial,
  loadGlobalBillingSettings,
  envDefaultTrialWeeks,
  SCHOOL_TRIAL_SELECT,
};
