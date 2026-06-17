const User = require("../models/User");

const EMAIL_IN_USE_MESSAGE =
  "This email is already registered. Please use a different email.";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmailFormat(email) {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm);
}

/** Case-insensitive lookup — one email = one account globally. */
async function findUserByEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  return User.findOne({
    email: { $regex: new RegExp(`^${escapeRegex(norm)}$`, "i") },
  });
}

/**
 * Ensure email is not used by another account (any role).
 * @param {string} email
 * @param {{ excludeUserId?: string }} options
 */
async function assertEmailAvailable(email, options = {}) {
  const norm = normalizeEmail(email);
  if (!norm) {
    return { ok: false, status: 400, message: "A valid email is required." };
  }
  if (!isValidEmailFormat(norm)) {
    return {
      ok: false,
      status: 400,
      message: "Please provide a valid email address.",
    };
  }

  const existing = await findUserByEmail(norm);
  if (existing) {
    const excludeUserId = options.excludeUserId;
    if (excludeUserId && String(existing._id) === String(excludeUserId)) {
      return { ok: true, normalizedEmail: norm, existingUser: existing };
    }
    return {
      ok: false,
      status: 409,
      message: EMAIL_IN_USE_MESSAGE,
      existingUser: existing,
    };
  }

  return { ok: true, normalizedEmail: norm };
}

module.exports = {
  normalizeEmail,
  findUserByEmail,
  assertEmailAvailable,
  isValidEmailFormat,
  EMAIL_IN_USE_MESSAGE,
};
