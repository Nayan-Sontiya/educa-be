// cron/markTeachersAbsent.js
// Runs daily at 18:00 (6 PM) – marks all teachers who haven't checked in as Absent
const cron = require("node-cron");
const { markAbsentAll } = require("../controllers/teacherAttendanceController");

// "0 18 * * *" = every day at 6:00 PM server time
cron.schedule("0 18 * * *", async () => {
  console.log("[Cron] Running daily teacher absent job...");
  await markAbsentAll();
});

console.log("[Cron] Teacher absent job scheduled (daily at 18:00)");
