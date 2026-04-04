const SchoolSubscription = require("../models/SchoolSubscription");

/**
 * True if this school must be blocked from API/login (subscription suspended).
 * Admin bypass window overrides suspension until adminUnblockUntil.
 */
async function isSchoolSubscriptionSuspended(schoolId) {
  if (!schoolId) return false;
  const sub = await SchoolSubscription.findOne({ schoolId }).lean();
  if (!sub) return false;
  if (sub.adminUnblockUntil && new Date(sub.adminUnblockUntil) > new Date()) {
    return false;
  }
  return sub.status === "suspended";
}

module.exports = { isSchoolSubscriptionSuspended };
