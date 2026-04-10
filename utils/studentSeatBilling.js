const mongoose = require("mongoose");
const Student = require("../models/Student");
const SchoolSubscription = require("../models/SchoolSubscription");

/** Students that count toward the purchased Stripe seat quantity */
const includedSeatMatch = {
  $or: [{ seatBillingStatus: { $exists: false } }, { seatBillingStatus: "included" }],
};

async function countRosterActiveStudents(schoolId) {
  if (!schoolId) return 0;
  return Student.countDocuments({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    status: "active",
  });
}

async function countIncludedSeatStudents(schoolId) {
  if (!schoolId) return 0;
  return Student.countDocuments({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    status: "active",
    ...includedSeatMatch,
  });
}

async function countPendingSeatStudents(schoolId) {
  if (!schoolId) return 0;
  return Student.countDocuments({
    schoolId: new mongoose.Types.ObjectId(schoolId),
    status: "active",
    seatBillingStatus: "pending_purchase",
  });
}

async function seatBillingStatusForNewEnrollment() {
  return "included";
}

module.exports = {
  includedSeatMatch,
  countRosterActiveStudents,
  countIncludedSeatStudents,
  countPendingSeatStudents,
  seatBillingStatusForNewEnrollment,
};
