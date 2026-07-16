/**
 * Database Repair Script: Sync Razorpay Paid Orders & Subscriptions
 * 
 * Scans local SchoolSubscription documents and queries Razorpay to verify if payment was completed.
 * If Razorpay shows the order is paid or the subscription is active, it updates the MongoDB state to "active".
 * 
 * Usage:
 *   node scripts/syncRazorpayPaidOrders.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");
const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");
const { 
  getRazorpay, 
  fetchSubscription,
  mapRazorpaySubscriptionStatus,
  periodBoundsFromRazorpaySubscription
} = require("../utils/razorpayService");
const { periodBoundsForPlan } = require("../utils/subscriptionPricing");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI environment variable is not set.");
    process.exit(1);
  }

  const rzp = getRazorpay();
  if (!rzp) {
    console.error("❌ Razorpay is not configured on the server.");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("✅ Connected to database.");

  // Fetch subscriptions that are pending or inactive but have payment gateway references
  const subs = await SchoolSubscription.find({
    status: { $in: ["pending", "inactive"] },
    $or: [
      { razorpayOrderId: { $exists: true, $ne: "" } },
      { razorpaySubscriptionId: { $exists: true, $ne: "" } }
    ]
  });

  console.log(`🔍 Found ${subs.length} subscriptions in pending/inactive state with Razorpay references.`);

  let updatedCount = 0;

  for (const subDoc of subs) {
    const school = await School.findById(subDoc.schoolId).select("name").lean();
    const schoolName = school?.name || `School (${subDoc.schoolId})`;
    let updated = false;

    // Case 1: Checking one-time order payments (razorpayOrderId)
    if (subDoc.razorpayOrderId) {
      try {
        console.log(`📡 Fetching order ${subDoc.razorpayOrderId} for "${schoolName}"...`);
        const order = await rzp.orders.fetch(subDoc.razorpayOrderId);
        
        if (order.status === "paid") {
          console.log(`💰 Order ${subDoc.razorpayOrderId} is PAID. Syncing database state...`);
          
          const bounds = periodBoundsForPlan(subDoc.plan || "monthly", new Date());
          subDoc.currentPeriodStart = bounds.currentPeriodStart;
          subDoc.currentPeriodEnd = bounds.currentPeriodEnd;
          subDoc.status = "active";
          subDoc.graceStartedAt = undefined;
          subDoc.graceEndsAt = undefined;
          subDoc.graceReminderDay = undefined;
          subDoc.remindersSent = { preDue3: false, preDue2: false, preDue1: false };
          subDoc.lastPaymentAt = new Date();
          
          await subDoc.save();
          console.log(`✅ Subscription for "${schoolName}" is now ACTIVE.`);
          updated = true;
        } else {
          console.log(`ℹ️ Order ${subDoc.razorpayOrderId} status is "${order.status}" (not paid).`);
        }
      } catch (err) {
        console.error(`❌ Error fetching order ${subDoc.razorpayOrderId}:`, err.message);
      }
    }

    // Case 2: Checking recurring subscriptions (razorpaySubscriptionId)
    if (!updated && subDoc.razorpaySubscriptionId) {
      try {
        console.log(`📡 Fetching subscription ${subDoc.razorpaySubscriptionId} for "${schoolName}"...`);
        const rzpSub = await fetchSubscription(subDoc.razorpaySubscriptionId);
        
        if (rzpSub) {
          const mapped = mapRazorpaySubscriptionStatus(rzpSub.status);
          
          if (mapped === "active") {
            console.log(`💰 Subscription ${subDoc.razorpaySubscriptionId} is ACTIVE on Razorpay. Syncing database...`);
            
            subDoc.status = "active";
            subDoc.graceStartedAt = undefined;
            subDoc.graceEndsAt = undefined;
            subDoc.graceReminderDay = undefined;
            subDoc.remindersSent = { preDue3: false, preDue2: false, preDue1: false };
            subDoc.lastPaymentAt = new Date();
            
            const bounds = periodBoundsFromRazorpaySubscription(rzpSub);
            if (bounds.currentPeriodStart) subDoc.currentPeriodStart = bounds.currentPeriodStart;
            if (bounds.currentPeriodEnd) subDoc.currentPeriodEnd = bounds.currentPeriodEnd;
            
            await subDoc.save();
            console.log(`✅ Subscription for "${schoolName}" is now ACTIVE.`);
            updated = true;
          } else {
            console.log(`ℹ️ Subscription ${subDoc.razorpaySubscriptionId} status is "${rzpSub.status}" (not active).`);
          }
        }
      } catch (err) {
        console.error(`❌ Error fetching subscription ${subDoc.razorpaySubscriptionId}:`, err.message);
      }
    }

    if (updated) {
      updatedCount++;
    }
  }

  console.log(`\n🎉 Sync run complete. Total subscriptions updated to active: ${updatedCount}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Sync script failed:", e);
  process.exit(1);
});
