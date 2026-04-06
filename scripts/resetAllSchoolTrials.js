/**
 * Reset the school-level billing trial anchor for every Verified school.
 *
 * Sets verifiedAt to "now" so the free trial window (SCHOOL_TRIAL_WEEKS, default 4)
 * restarts from this run for all of them. Does not change verificationStatus.
 *
 * Does NOT touch Stripe / SchoolSubscription (existing paid subs stay as-is in DB;
 * access rules still apply from subscription status).
 *
 * For launch (trial + subscription status), prefer:
 *   node scripts/launchAllSchoolsTrial.js
 *
 * Usage (from educa-be root, with MONGO_URI in .env):
 *   node scripts/resetAllSchoolTrials.js
 *
 * Dry run (no writes):
 *   node scripts/resetAllSchoolTrials.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const School = require("../models/School");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");

  await mongoose.connect(uri);

  const filter = { verificationStatus: "Verified" };
  const count = await School.countDocuments(filter);
  const now = new Date();

  console.log(`Verified schools matching filter: ${count}`);
  console.log(`Will set verifiedAt to: ${now.toISOString()}`);

  if (dryRun) {
    console.log("Dry run — no updates applied.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const result = await School.updateMany(filter, { $set: { verifiedAt: now } });
  console.log("updateMany result:", {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
