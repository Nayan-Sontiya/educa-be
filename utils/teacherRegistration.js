const User = require("../models/User");
const Teacher = require("../models/Teacher");

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

async function findUsersByEmail(email) {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return [];
  return User.find({ email: trimmedEmail })
    .select("_id email phone phoneNormalized role schoolId")
    .lean();
}

async function findTeacherAtSchool(schoolId, userIds) {
  if (!schoolId || !userIds?.length) return null;
  return Teacher.findOne({
    schoolId,
    userId: { $in: userIds },
  }).lean();
}

/**
 * True when email already has a teacher profile at this school.
 */
async function hasTeacherRegistrationAtSchool(schoolId, email) {
  const users = await findUsersByEmail(email);
  const userIds = users.map((u) => u._id);
  if (!userIds.length) return false;
  const atSchool = await findTeacherAtSchool(schoolId, userIds);
  return Boolean(atSchool);
}

async function resolveExistingUserForTeacherRegistration(email) {
  const users = await findUsersByEmail(email);
  if (users.length === 0) {
    return { ok: true, existingUser: null, users: [] };
  }
  if (users.length === 1) {
    return { ok: true, existingUser: users[0], users };
  }

  return {
    ok: false,
    status: 400,
    message: "This email is already registered with multiple accounts.",
  };
}

/**
 * Validates teacher registration at a school.
 * - Blocks duplicate teacher at the same school (same email).
 * - Allows same person at a different school (link existing user).
 * - Allows school admin at the same school to add a teacher profile (link user).
 * - Duplicate mobile numbers are allowed.
 */
async function validateTeacherRegistrationAtSchool(schoolId, email) {
  if (await hasTeacherRegistrationAtSchool(schoolId, email)) {
    return {
      ok: false,
      status: 400,
      message:
        "This email is already registered as a teacher at this school.",
    };
  }

  const resolved = await resolveExistingUserForTeacherRegistration(email);
  if (!resolved.ok) return resolved;

  const { existingUser } = resolved;
  if (!existingUser) {
    return { ok: true, mode: "create_user", existingUser: null };
  }

  if (
    existingUser.role === "school_admin" &&
    sameId(existingUser.schoolId, schoolId)
  ) {
    return { ok: true, mode: "link_user", existingUser };
  }

  if (existingUser.role === "teacher") {
    return { ok: true, mode: "link_user", existingUser };
  }

  if (
    existingUser.role === "school_admin" &&
    !sameId(existingUser.schoolId, schoolId)
  ) {
    return { ok: true, mode: "link_user", existingUser };
  }

  const roleMessages = {
    parent: "This email belongs to a parent account.",
    student: "This email belongs to a student account.",
    admin: "This email is already used by a platform admin account.",
    counselor: "This email belongs to a counselor account.",
  };

  return {
    ok: false,
    status: 400,
    message:
      roleMessages[existingUser.role] ||
      "This email is already registered with a different account type.",
  };
}

module.exports = {
  validateTeacherRegistrationAtSchool,
  hasTeacherRegistrationAtSchool,
  findUsersByEmail,
  findTeacherAtSchool,
  sameId,
};
