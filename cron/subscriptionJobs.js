// Daily subscription pre-renewal reminders
const cron = require("node-cron");
const { runSubscriptionReminderJobs } = require("../controllers/subscriptionController");

cron.schedule("0 8 * * *", async () => {
  console.log("[Cron] Subscription reminder job…");
  try {
    await runSubscriptionReminderJobs();
  } catch (e) {
    console.error("[Cron] Subscription job error:", e);
  }
});

console.log("[Cron] Subscription reminder job scheduled (daily at 08:00 server time)");
