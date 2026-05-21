/**
 * Expire billing period for one school (testing).
 * Usage: node scripts/expireSchoolPlan.js <schoolId>
 */
require("dotenv").config();
const mongoose = require("mongoose");
const SchoolSubscription = require("../models/SchoolSubscription");

const schoolId = process.argv[2];
if (!schoolId) {
  console.error("Usage: node scripts/expireSchoolPlan.js <schoolId>");
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const before = await SchoolSubscription.findOne({ schoolId }).lean();
  console.log("BEFORE:", before);

  if (!before) {
    console.error("No SchoolSubscription for schoolId:", schoolId);
    await mongoose.disconnect();
    process.exit(1);
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);

  const periodStart = new Date(yesterday);
  periodStart.setMonth(periodStart.getMonth() - 1);
  periodStart.setHours(0, 0, 0, 0);

  const updated = await SchoolSubscription.findOneAndUpdate(
    { schoolId },
    {
      $set: {
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: yesterday,
      },
    },
    { new: true }
  ).lean();

  console.log("AFTER:", updated);
  console.log("planExpired (app logic):", new Date(updated.currentPeriodEnd) <= new Date());
  console.log("subscriptionActivePaid:", updated.status === "active" && new Date(updated.currentPeriodEnd) > new Date());

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
