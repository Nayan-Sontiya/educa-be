/**
 * Remove local SchoolSubscription rows that never completed Stripe checkout
 * (status incomplete and no stripeSubscriptionId). Safe for clearing dev/test noise.
 * Does not call Stripe — cancel test subs in Stripe Dashboard separately if needed.
 *
 * Usage (from educa-be, MONGO_URI in .env):
 *   node scripts/cleanupIncompleteSubscriptions.js --dry-run
 *   node scripts/cleanupIncompleteSubscriptions.js
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

  const filter = {
    status: "incomplete",
    $or: [
      { stripeSubscriptionId: { $exists: false } },
      { stripeSubscriptionId: null },
      { stripeSubscriptionId: "" },
    ],
  };

  const count = await SchoolSubscription.countDocuments(filter);
  console.log(`Matching incomplete subscriptions (no Stripe id): ${count}`);

  if (dryRun) {
    console.log("Dry run — no deletes.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const result = await SchoolSubscription.deleteMany(filter);
  console.log("Deleted:", result.deletedCount);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
