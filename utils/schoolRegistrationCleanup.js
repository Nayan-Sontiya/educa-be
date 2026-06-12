const School = require("../models/School");
const User = require("../models/User");
const Class = require("../models/Class");
const ClassSection = require("../models/ClassSection");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findUserByEmailInsensitive(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  return User.findOne({
    email: { $regex: new RegExp(`^${escapeRegex(norm)}$`, "i") },
  });
}

async function deleteSchoolArtifacts(schoolId) {
  if (!schoolId) return;
  await ClassSection.deleteMany({ schoolId });
  await Class.deleteMany({ schoolId });
  await School.deleteOne({ _id: schoolId });
}

function isCompleteSchoolRegistration(user, school) {
  return (
    user &&
    school &&
    user.role === "school_admin" &&
    user.schoolId &&
    String(user.schoolId) === String(school._id)
  );
}

/**
 * Remove leftover user/school rows from a failed school signup so the same
 * email or UDISE can be used again.
 */
async function cleanupIncompleteSchoolRegistration(email, udiseCode) {
  const normEmail = normalizeEmail(email);
  let cleaned = false;

  const schoolQuery = [];
  if (normEmail) schoolQuery.push({ email: { $regex: new RegExp(`^${escapeRegex(normEmail)}$`, "i") } });
  if (udiseCode) schoolQuery.push({ udiseCode: String(udiseCode).trim() });

  const schools =
    schoolQuery.length > 0
      ? await School.find({ $or: schoolQuery })
      : [];

  for (const school of schools) {
    const owner = school.createdBy
      ? await User.findById(school.createdBy)
      : await User.findOne({ schoolId: school._id, role: "school_admin" });

    if (!isCompleteSchoolRegistration(owner, school)) {
      await deleteSchoolArtifacts(school._id);
      if (owner && owner.role === "school_admin") {
        await User.deleteOne({ _id: owner._id });
      }
      cleaned = true;
    }
  }

  const orphanUser = normEmail
    ? await findUserByEmailInsensitive(normEmail)
    : null;

  if (orphanUser && orphanUser.role === "school_admin") {
    if (!orphanUser.schoolId) {
      await User.deleteOne({ _id: orphanUser._id });
      cleaned = true;
    } else {
      const linkedSchool = await School.findById(orphanUser.schoolId);
      if (!linkedSchool) {
        await User.deleteOne({ _id: orphanUser._id });
        cleaned = true;
      }
    }
  }

  return { cleaned };
}

async function rollbackSchoolRegistration(userId, schoolId) {
  try {
    if (schoolId) {
      await deleteSchoolArtifacts(schoolId);
    }
    if (userId) {
      await User.deleteOne({ _id: userId });
    }
  } catch (err) {
    console.error("rollbackSchoolRegistration:", err);
  }
}

function formatMongooseValidationError(error) {
  if (!error?.errors) return "Invalid registration data. Please check all fields.";
  const messages = Object.values(error.errors)
    .map((e) => e?.message)
    .filter(Boolean);
  return messages.length
    ? messages.join(" ")
    : "Invalid registration data. Please check all fields.";
}

function formatDuplicateKeyError(error) {
  const keyPattern = error.keyPattern || {};
  const keyValue = error.keyValue || {};

  if (keyPattern.email) {
    return `Email "${keyValue.email}" is already registered. If you did not finish signup earlier, try again now or contact support.`;
  }
  if (keyPattern.udiseCode) {
    return `UDISE code "${keyValue.udiseCode}" is already registered.`;
  }
  return "A record with these details already exists.";
}

module.exports = {
  normalizeEmail,
  findUserByEmailInsensitive,
  cleanupIncompleteSchoolRegistration,
  rollbackSchoolRegistration,
  isCompleteSchoolRegistration,
  formatMongooseValidationError,
  formatDuplicateKeyError,
};
