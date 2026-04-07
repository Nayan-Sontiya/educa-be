/**
 * One-time migration:
 * Keep only 3 subscription statuses in Mongo:
 * - trialing
 * - active
 * - inactive
 *
 * Any legacy status is converted to "inactive".
 */
const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/db");
const SchoolSubscription = require("../models/SchoolSubscription");

async function run() {
  await connectDB();

  const valid = ["trialing", "active", "inactive"];
  const legacyFilter = { status: { $nin: valid } };

  const legacyCount = await SchoolSubscription.countDocuments(legacyFilter);
  console.log(`Legacy subscription docs to migrate: ${legacyCount}`);

  if (legacyCount > 0) {
    const result = await SchoolSubscription.updateMany(
      legacyFilter,
      { $set: { status: "inactive" } }
    );
    console.log("Migration result:", result);
  }

  const summary = await SchoolSubscription.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log("Status summary:", summary);
}

run()
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {}
  });

