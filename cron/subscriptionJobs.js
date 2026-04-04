// Daily subscription reminders (pre-due) + grace enforcement + suspend after grace
const cron = require("node-cron");
const { runReminderAndGraceJobs } = require("../controllers/subscriptionController");

cron.schedule("0 8 * * *", async () => {
  console.log("[Cron] Subscription reminders / grace job…");
  try {
    await runReminderAndGraceJobs();
  } catch (e) {
    console.error("[Cron] Subscription job error:", e);
  }
});

console.log("[Cron] Subscription job scheduled (daily at 08:00 server time)");
