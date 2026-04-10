/**
 * Set every SchoolSubscription.status to "inactive".
 * Does not cancel subscriptions in Stripe — use the Dashboard if billing must match.
 *
 * Usage (from educa-be root, MONGO_URI in .env):
 *   node scripts/setAllSchoolSubscriptionsInactive.js --dry-run
 *   node scripts/setAllSchoolSubscriptionsInactive.js --i-am-sure
 */
require("dotenv").config();
const mongoose = require("mongoose");
const SchoolSubscription = require("../models/SchoolSubscription");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--i-am-sure");

  if (!dryRun && !confirmed) {
    console.error("Refusing: pass --dry-run to inspect counts, or --i-am-sure to apply.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const total = await SchoolSubscription.countDocuments({});
  const notInactive = await SchoolSubscription.countDocuments({
    status: { $ne: "inactive" },
  });

  console.log(`SchoolSubscription documents: ${total}`);
  console.log(`Currently not inactive: ${notInactive}`);

  if (dryRun) {
    console.log("Dry run — no writes.");
    await mongoose.disconnect();
    return;
  }

  const res = await SchoolSubscription.updateMany({}, { $set: { status: "inactive" } });
  console.log("updateMany:", {
    matchedCount: res.matchedCount,
    modifiedCount: res.modifiedCount,
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
