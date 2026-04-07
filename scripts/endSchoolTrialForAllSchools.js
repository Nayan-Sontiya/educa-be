/**
 * End the school-level free trial for every Verified school (for testing or staged rollouts).
 *
 * Sets School.verifiedAt far enough in the past that getSchoolBillingAccess() treats the
 * trial as finished (uses SCHOOL_TRIAL_WEEKS from env, default 4, same as subscriptionAccess.js).
 *
 * Optional: simulate "trial ended, no payment" by resetting each school's SchoolSubscription
 * to incomplete and clearing Stripe fields (does NOT cancel subscriptions in Stripe — do that
 * in Dashboard if needed).
 *
 * Usage (educa-be root, MONGO_URI in .env):
 *   node scripts/endSchoolTrialForAllSchools.js --dry-run
 *   node scripts/endSchoolTrialForAllSchools.js
 *
 * Trial ended + no local subscription record (no payment path):
 *   node scripts/endSchoolTrialForAllSchools.js --dry-run --simulate-no-payment
 *   node scripts/endSchoolTrialForAllSchools.js --simulate-no-payment --i-am-sure
 *
 * Override how far back verifiedAt is set (e.g. "1 month ago" feel):
 *   node scripts/endSchoolTrialForAllSchools.js --past-days 45 --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");

function trialDurationMs() {
  const weeks = Number(process.env.SCHOOL_TRIAL_WEEKS) || 4;
  if (!Number.isFinite(weeks) || weeks < 0) {
    return 4 * 7 * 24 * 60 * 60 * 1000;
  }
  return weeks * 7 * 24 * 60 * 60 * 1000;
}

function parsePastDaysArg() {
  const i = process.argv.indexOf("--past-days");
  if (i === -1 || !process.argv[i + 1]) return null;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const simulateNoPayment =
    process.argv.includes("--simulate-no-payment") || process.argv.includes("--no-payment");
  const confirmed = process.argv.includes("--i-am-sure");

  if (simulateNoPayment && !dryRun && !confirmed) {
    console.error(
      'Refusing: --simulate-no-payment rewrites SchoolSubscription. Re-run with --i-am-sure (and use staging / backups).',
    );
    process.exit(1);
  }

  await mongoose.connect(uri);

  const schoolFilter = { verificationStatus: "Verified" };
  const schoolCount = await School.countDocuments(schoolFilter);

  const pastDays = parsePastDaysArg();
  const now = Date.now();
  let verifiedAt;
  if (pastDays != null) {
    verifiedAt = new Date(now - pastDays * 86400000);
    console.log(`Using --past-days ${pastDays} → verifiedAt = ${verifiedAt.toISOString()}`);
  } else {
    const ms = trialDurationMs();
    verifiedAt = new Date(now - ms - 86400000);
    console.log(
      `Trial length from env: ${ms / 86400000} days (SCHOOL_TRIAL_WEEKS). Setting verifiedAt = ${verifiedAt.toISOString()} (trial end + 1 day).`,
    );
  }

  console.log(`Verified schools to update: ${schoolCount}`);
  console.log(`simulate-no-payment (reset local subscription docs): ${simulateNoPayment}`);

  if (dryRun) {
    console.log("Dry run — no writes.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const schoolRes = await School.updateMany(schoolFilter, { $set: { verifiedAt } });
  console.log("Schools verifiedAt updated:", {
    matchedCount: schoolRes.matchedCount,
    modifiedCount: schoolRes.modifiedCount,
  });

  if (simulateNoPayment) {
    const schoolIds = await School.find(schoolFilter).distinct("_id");
    const subRes = await SchoolSubscription.updateMany(
      { schoolId: { $in: schoolIds } },
      {
        $set: {
          status: "inactive",
          billedStudentCount: 0,
        },
        $unset: {
          plan: "",
          stripeCustomerId: "",
          stripeSubscriptionId: "",
          stripePriceId: "",
          currentPeriodStart: "",
          currentPeriodEnd: "",
          lastPaymentAt: "",
          graceStartedAt: "",
          graceEndsAt: "",
          graceReminderDay: "",
          canceledAt: "",
          billingMode: "",
        },
      },
    );
    console.log("SchoolSubscription reset (incomplete, Stripe fields cleared):", {
      matchedCount: subRes.matchedCount,
      modifiedCount: subRes.modifiedCount,
    });
    console.warn(
      "Stripe may still have live subscriptions — cancel in Stripe Dashboard if you need billing to match.",
    );
  }

  await mongoose.disconnect();
  console.log("Done. Expect: inTrial false, needsSubscription true until checkout completes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
