/**
 * Force-reset for testing:
 * 1) Marks ALL schools as Verified today (verificationStatus + verifiedAt).
 * 2) Ensures EVERY school has a SchoolSubscription row with status "trialing".
 * 3) Forces existing SchoolSubscription status to "trialing".
 *
 * Usage:
 *   node scripts/setAllSchoolsApprovedTodayTrialing.js --dry-run
 *   node scripts/setAllSchoolsApprovedTodayTrialing.js
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
  const now = new Date();

  await mongoose.connect(uri);

  const totalSchools = await School.countDocuments({});
  const existingSubs = await SchoolSubscription.countDocuments({});
  console.log(`Schools total: ${totalSchools}`);
  console.log(`Subscription docs existing: ${existingSubs}`);
  console.log(`Will set verificationStatus=Verified and verifiedAt=${now.toISOString()}`);
  console.log(`Will set all SchoolSubscription.status="trialing"`);

  if (dryRun) {
    console.log("Dry run — no writes.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // 1) Approve all schools today.
  const schoolRes = await School.updateMany(
    {},
    {
      $set: {
        verificationStatus: "Verified",
        verifiedAt: now,
      },
      $unset: {
        rejectionReason: "",
        reviewNote: "",
      },
    }
  );

  console.log("Schools updated:", {
    matchedCount: schoolRes.matchedCount,
    modifiedCount: schoolRes.modifiedCount,
  });

  // 2) Ensure every school has a subscription row.
  const schoolIds = await School.find({}, { _id: 1 }).lean();
  const ops = schoolIds.map((s) => ({
    updateOne: {
      filter: { schoolId: s._id },
      update: {
        $setOnInsert: {
          schoolId: s._id,
          status: "trialing",
          billingMode: "per_seat",
          billedStudentCount: 0,
          pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length) {
    const upsertRes = await SchoolSubscription.bulkWrite(ops, { ordered: false });
    console.log("Subscription rows ensured:", {
      matched: upsertRes.matchedCount,
      modified: upsertRes.modifiedCount,
      upserted: upsertRes.upsertedCount,
    });
  }

  // 3) Force every subscription status to trialing.
  const subRes = await SchoolSubscription.updateMany(
    {},
    {
      $set: { status: "trialing" },
      $unset: { graceEndsAt: "", graceStartedAt: "", graceReminderDay: "", canceledAt: "" },
    }
  );

  console.log("Subscriptions status forced:", {
    matchedCount: subRes.matchedCount,
    modifiedCount: subRes.modifiedCount,
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

