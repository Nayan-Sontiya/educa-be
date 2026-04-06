/**
 * Launch-day reset: every Verified school starts the school-level free trial from now,
 * and all Mongo subscription rows in "active" become "trialing" (product convention).
 *
 * 1) School: verificationStatus === "Verified" → verifiedAt = now (trial window from SCHOOL_TRIAL_WEEKS)
 * 2) SchoolSubscription: status "active" → "trialing"
 * 3) SchoolSubscription: status "grace" → "trialing" (clears grace* fields)
 *
 * Does not call Stripe. Run once before/after go-live.
 *
 * To end trial for all schools (e.g. test “trial over, no payment”):
 *   node scripts/endSchoolTrialForAllSchools.js
 *
 * Usage (educa-be root, MONGO_URI in .env):
 *   node scripts/launchAllSchoolsTrial.js --dry-run
 *   node scripts/launchAllSchoolsTrial.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(uri);

  const now = new Date();

  const schoolFilter = { verificationStatus: "Verified" };
  const schoolCount = await School.countDocuments(schoolFilter);
  console.log(`Verified schools: ${schoolCount}`);
  console.log(`Will set verifiedAt to: ${now.toISOString()}`);

  const activeSubCount = await SchoolSubscription.countDocuments({ status: "active" });
  const graceSubCount = await SchoolSubscription.countDocuments({ status: "grace" });
  console.log(`SchoolSubscription "active" → trialing: ${activeSubCount}`);
  console.log(`SchoolSubscription "grace" → trialing: ${graceSubCount}`);

  if (dryRun) {
    console.log("Dry run — no writes.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const schoolRes = await School.updateMany(schoolFilter, { $set: { verifiedAt: now } });
  console.log("Schools updated:", {
    matchedCount: schoolRes.matchedCount,
    modifiedCount: schoolRes.modifiedCount,
  });

  const subActive = await SchoolSubscription.updateMany(
    { status: "active" },
    { $set: { status: "trialing" } }
  );
  console.log("Subscriptions active→trialing:", {
    matchedCount: subActive.matchedCount,
    modifiedCount: subActive.modifiedCount,
  });

  const subGrace = await SchoolSubscription.updateMany(
    { status: "grace" },
    {
      $set: { status: "trialing" },
      $unset: { graceEndsAt: "", graceStartedAt: "", graceReminderDay: "" },
    }
  );
  console.log("Subscriptions grace→trialing:", {
    matchedCount: subGrace.matchedCount,
    modifiedCount: subGrace.modifiedCount,
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
