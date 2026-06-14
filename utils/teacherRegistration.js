const User = require("../models/User");
const Teacher = require("../models/Teacher");
const { normalizePhone } = require("./phone");

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function buildEmailPhoneOrConditions(email, phoneRaw) {
  const trimmedEmail = email?.trim();
  const pn = normalizePhone(phoneRaw);
  const or = [];
  if (trimmedEmail) or.push({ email: trimmedEmail });
  if (pn) {
    or.push({ phoneNormalized: pn }, { phone: pn });
    if (phoneRaw && String(phoneRaw).trim() !== pn) {
      or.push({ phone: String(phoneRaw).trim() });
    }
  }
  return { or, pn, trimmedEmail };
}

async function findUsersByEmailOrPhone(email, phoneRaw) {
  const { or } = buildEmailPhoneOrConditions(email, phoneRaw);
  if (!or.length) return [];
  return User.find({ $or: or })
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

async function findTeacherAtSchoolByPhone(schoolId, phoneRaw) {
  const pn = normalizePhone(phoneRaw);
  if (!schoolId || !pn) return null;
  const candidates = [pn, String(phoneRaw || "").trim()].filter(Boolean);
  return Teacher.findOne({
    schoolId,
    phone: { $in: candidates },
  }).lean();
}

/**
 * True when email/phone already has a teacher profile at this school.
 */
async function hasTeacherRegistrationAtSchool(schoolId, email, phoneRaw) {
  const users = await findUsersByEmailOrPhone(email, phoneRaw);
  const userIds = users.map((u) => u._id);

  const byUser =
    userIds.length > 0
      ? await findTeacherAtSchool(schoolId, userIds)
      : null;
  if (byUser) return true;

  const byPhone = await findTeacherAtSchoolByPhone(schoolId, phoneRaw);
  return Boolean(byPhone);
}

async function resolveExistingUserForTeacherRegistration(email, phoneRaw) {
  const users = await findUsersByEmailOrPhone(email, phoneRaw);
  if (users.length === 0) {
    return { ok: true, existingUser: null, users: [] };
  }
  if (users.length === 1) {
    return { ok: true, existingUser: users[0], users };
  }

  const trimmedEmail = email?.trim()?.toLowerCase();
  const pn = normalizePhone(phoneRaw);
  const byEmail = trimmedEmail
    ? users.find((u) => u.email?.toLowerCase() === trimmedEmail)
    : null;
  const byPhone = pn
    ? users.find(
        (u) => u.phoneNormalized === pn || u.phone === pn || u.phone === phoneRaw
      )
    : null;

  if (byEmail && byPhone && String(byEmail._id) !== String(byPhone._id)) {
    return {
      ok: false,
      status: 400,
      message: "Email and mobile number belong to different accounts.",
    };
  }

  return {
    ok: true,
    existingUser: byEmail || byPhone || users[0],
    users,
  };
}

/**
 * Validates teacher registration at a school.
 * - Blocks duplicate teacher at the same school (same email or mobile).
 * - Allows same person at a different school (link existing user).
 * - Allows school admin at the same school to add a teacher profile (link user).
 */
async function validateTeacherRegistrationAtSchool(schoolId, email, phoneRaw) {
  if (await hasTeacherRegistrationAtSchool(schoolId, email, phoneRaw)) {
    return {
      ok: false,
      status: 400,
      message:
        "This email or mobile number is already registered as a teacher at this school.",
    };
  }

  const resolved = await resolveExistingUserForTeacherRegistration(
    email,
    phoneRaw
  );
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
    parent: "This mobile or email belongs to a parent account.",
    student: "This mobile or email belongs to a student account.",
    admin: "This email is already used by a platform admin account.",
    counselor: "This email or mobile belongs to a counselor account.",
  };

  return {
    ok: false,
    status: 400,
    message:
      roleMessages[existingUser.role] ||
      "This email or mobile is already registered with a different account type.",
  };
}

/** OTP pre-check for teacher self-signup (phone may exist at other schools). */
async function isPhoneBlockedForTeacherSignup(schoolId, mobileNormalized) {
  if (!schoolId || !mobileNormalized) {
    return { blocked: false };
  }

  const users = await User.find({
    $or: [
      { phoneNormalized: mobileNormalized },
      { phone: mobileNormalized },
    ],
  })
    .select("_id")
    .lean();

  if (users.length) {
    const atSchool = await findTeacherAtSchool(
      schoolId,
      users.map((u) => u._id)
    );
    if (atSchool) {
      return {
        blocked: true,
        message:
          "This mobile number is already registered as a teacher at this school.",
      };
    }
  }

  const byPhone = await findTeacherAtSchoolByPhone(schoolId, mobileNormalized);
  if (byPhone) {
    return {
      blocked: true,
      message:
        "This mobile number is already registered as a teacher at this school.",
    };
  }

  return { blocked: false };
}

module.exports = {
  validateTeacherRegistrationAtSchool,
  isPhoneBlockedForTeacherSignup,
  hasTeacherRegistrationAtSchool,
  findUsersByEmailOrPhone,
  findTeacherAtSchool,
  sameId,
};
