const jwt = require("jsonwebtoken");
const { normalizeEmail } = require("./emailUniqueness");

const DEFAULT_TTL = "15m";

function issueEmailVerificationToken(email, expiresIn = DEFAULT_TTL) {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    throw new Error("Cannot issue email verification token without valid email");
  }

  return jwt.sign(
    { typ: "email_verified", email: emailNormalized },
    process.env.JWT_SECRET,
    { expiresIn },
  );
}

function assertEmailVerificationToken(token, email) {
  if (!token || typeof token !== "string") {
    return {
      ok: false,
      message: "Please verify your email address before continuing.",
    };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return {
      ok: false,
      message: "Email verification expired. Please verify your email again.",
    };
  }

  if (decoded?.typ !== "email_verified" || !decoded?.email) {
    return { ok: false, message: "Invalid email verification token." };
  }

  const verifiedEmail = normalizeEmail(decoded.email);
  const claimedEmail = normalizeEmail(email);
  if (!verifiedEmail || !claimedEmail || verifiedEmail !== claimedEmail) {
    return {
      ok: false,
      message:
        "Email address does not match the verified email. Please verify again.",
    };
  }

  return { ok: true, email: verifiedEmail };
}

module.exports = {
  issueEmailVerificationToken,
  assertEmailVerificationToken,
  DEFAULT_TTL,
};
