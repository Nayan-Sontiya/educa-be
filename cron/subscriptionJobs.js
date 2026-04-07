// Daily subscription pre-renewal reminders
const cron = require("node-cron");
const {
  runSubscriptionReminderJobs,
  runTrialExpiryStatusSyncJob,
} = require("../controllers/subscriptionController");

cron.schedule("0 8 * * *", async () => {
  console.log("[Cron] Subscription reminder job…");
  try {
    await runSubscriptionReminderJobs();
  } catch (e) {
    console.error("[Cron] Subscription job error:", e);
  }
});

console.log("[Cron] Subscription reminder job scheduled (daily at 08:00 server time)");

// Daily trial expiry sync: explicit Mongo status transition trialing -> inactive after school trial end.
cron.schedule("15 0 * * *", async () => {
  console.log("[Cron] Trial expiry status sync job…");
  try {
    const result = await runTrialExpiryStatusSyncJob();
    console.log("[Cron] Trial expiry sync done:", result);
  } catch (e) {
    console.error("[Cron] Trial expiry sync error:", e);
  }
});

console.log("[Cron] Trial expiry status sync scheduled (daily at 00:15 server time)");
