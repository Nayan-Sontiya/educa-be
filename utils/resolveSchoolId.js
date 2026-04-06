const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

function schoolRefToIdString(schoolId) {
  if (!schoolId) return null;
  if (typeof schoolId === "string") return schoolId;
  if (typeof schoolId === "object" && schoolId !== null) {
    if (schoolId._id) return String(schoolId._id);
  }
  return String(schoolId);
}

/**
 * Resolve Mongo schoolId string for access-control (subscription, etc.)
 */
async function resolveSchoolIdForUser(user) {
  if (!user || !user._id) return null;
  if (user.schoolId) return schoolRefToIdString(user.schoolId);

  if (user.role === "teacher") {
    const t = await Teacher.findOne({ userId: user._id }).select("schoolId").lean();
    return t?.schoolId?.toString() || null;
  }

  if (user.role === "parent") {
    const s = await Student.findOne({ parentUserId: user._id, status: "active" })
      .select("schoolId")
      .sort({ updatedAt: -1 })
      .lean();
    return s?.schoolId?.toString() || null;
  }

  // Student-role users: schoolId on User if set at registration; no separate Student↔User link in schema
  if (user.role === "student" && user.schoolId) {
    return schoolRefToIdString(user.schoolId);
  }

  return null;
}

module.exports = { resolveSchoolIdForUser };
