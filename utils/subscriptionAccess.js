const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");

/** Subscription states that allow access after the school-level free trial ends. */
const PAID_ACCESS_STATUSES = ["active", "trialing"];

function hasStripeSubscriptionId(sub) {
  return Boolean(sub?.stripeSubscriptionId && String(sub.stripeSubscriptionId).trim());
}

/**
 * After school trial ended: only count a paid sub if it has a Stripe id and billing
 * is anchored on/after school trial end (blocks legacy "trialing" rows from test checkouts during trial).
 */
function subscriptionAnchoredAfterSchoolTrial(sub, trialEndsAtDate) {
  if (!sub || !trialEndsAtDate) return false;
  if (!PAID_ACCESS_STATUSES.includes(sub.status)) return false;
  if (!hasStripeSubscriptionId(sub)) return false;
  const trialEndMs = new Date(trialEndsAtDate).getTime();
  if (Number.isNaN(trialEndMs)) return false;
  const cps = sub.currentPeriodStart ? new Date(sub.currentPeriodStart).getTime() : NaN;
  const lpa = sub.lastPaymentAt ? new Date(sub.lastPaymentAt).getTime() : NaN;
  if (!Number.isNaN(cps) && cps >= trialEndMs) return true;
  if (!Number.isNaN(lpa) && lpa >= trialEndMs) return true;
  return false;
}

function trialDurationMs() {
  const weeks = Number(process.env.SCHOOL_TRIAL_WEEKS) || 4;
  if (!Number.isFinite(weeks) || weeks < 0) {
    return 4 * 7 * 24 * 60 * 60 * 1000;
  }
  return weeks * 7 * 24 * 60 * 60 * 1000;
}

function trialEndsAtFromSchool(school) {
  if (!school?.verifiedAt) return null;
  const start = new Date(school.verifiedAt).getTime();
  if (Number.isNaN(start)) return null;
  return new Date(start + trialDurationMs());
}

/**
 * True if this school must be blocked from API/login (subscription suspended).
 * Admin bypass window overrides suspension until adminUnblockUntil.
 *
 * `SchoolSubscription.status === "inactive"` alone is not enough: access during the
 * school-level free trial (from School.verifiedAt) is governed by getSchoolBillingAccess.
 * Otherwise a bulk "set all subscriptions inactive" would emit SUBSCRIPTION_SUSPENDED
 * even while the trial window is still open.
 */
async function isSchoolSubscriptionSuspended(schoolId) {
  if (!schoolId) return false;
  const sub = await SchoolSubscription.findOne({ schoolId }).lean();
  if (!sub) return false;
  if (sub.adminUnblockUntil && new Date(sub.adminUnblockUntil) > new Date()) {
    return false;
  }
  if (sub.status !== "inactive") return false;

  const school = await School.findById(schoolId)
    .select("verificationStatus verifiedAt")
    .lean();
  if (!school || school.verificationStatus !== "Verified") {
    return false;
  }
  if (!school.verifiedAt) {
    return false;
  }
  const trialEndsAt = trialEndsAtFromSchool(school);
  if (trialEndsAt && Date.now() <= trialEndsAt.getTime()) {
    return false;
  }

  return true;
}

/**
 * After a school is Verified, allow API access for SCHOOL_TRIAL_WEEKS (default 4) from verifiedAt.
 * After that, require status active or admin unblock (no grace period).
 * Schools Verified before verifiedAt existed are grandfathered (allowed) until verifiedAt is set.
 *
 * @param {import("mongoose").Types.ObjectId|string|null|undefined} schoolId
 * @param {{ school?: import("mongoose").LeanDocument<any>|null }} [options] Lean school doc to avoid an extra read
 */
async function getSchoolBillingAccess(schoolId, options = {}) {
  if (!schoolId) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
    };
  }

  let school = options.school;
  if (!school) {
    school = await School.findById(schoolId)
      .select("verificationStatus verifiedAt createdAt")
      .lean();
  }
  if (!school) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
    };
  }
  if (school.verificationStatus !== "Verified") {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
    };
  }

  if (!school.verifiedAt) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
    };
  }

  const trialEndsAt = trialEndsAtFromSchool(school);
  if (!trialEndsAt) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: null,
      needsSubscription: false,
    };
  }

  const trialEndMs = trialEndsAt.getTime();
  const now = Date.now();

  // School-level trial from verifiedAt: full app access, but Stripe checkout stays disabled
  // until this window ends (even if Mongo/Stripe still has a subscription row from tests).
  if (now <= trialEndMs) {
    return {
      allowed: true,
      inTrial: true,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
    };
  }

  const sub = await SchoolSubscription.findOne({ schoolId }).lean();

  if (sub?.adminUnblockUntil && new Date(sub.adminUnblockUntil) > new Date()) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
    };
  }

  if (subscriptionAnchoredAfterSchoolTrial(sub, trialEndsAt)) {
    return {
      allowed: true,
      inTrial: false,
      trialEndsAt: trialEndsAt.toISOString(),
      needsSubscription: false,
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
  };
}

module.exports = {
  isSchoolSubscriptionSuspended,
  getSchoolBillingAccess,
  trialEndsAtFromSchool,
  trialDurationMs,
  subscriptionAnchoredAfterSchoolTrial,
};
