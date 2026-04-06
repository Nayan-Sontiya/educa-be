/**
 * Legacy status "grace" → "trialing". Clears grace* fields. Does not call Stripe.
 *
 * Usage (educa-be root, MONGO_URI in .env):
 *   node scripts/migrateGraceToTrialing.js --dry-run
 *   node scripts/migrateGraceToTrialing.js
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
  await mongoose.connect(uri);

  const filter = { status: "grace" };
  const count = await SchoolSubscription.countDocuments(filter);
  console.log(`SchoolSubscription with status "grace": ${count}`);

  if (dryRun) {
    console.log("Dry run — no updates.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const r = await SchoolSubscription.updateMany(filter, {
    $set: { status: "trialing" },
    $unset: { graceEndsAt: "", graceStartedAt: "", graceReminderDay: "" },
  });
  console.log("Updated:", { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
