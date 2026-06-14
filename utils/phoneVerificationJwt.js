const jwt = require("jsonwebtoken");
const { normalize10 } = require("./firebasePhoneVerification");

const DEFAULT_TTL = "15m";

function issuePhoneVerificationToken(phone, expiresIn = DEFAULT_TTL) {
  const mobileNormalized = normalize10(phone);
  if (!mobileNormalized) {
    throw new Error("Cannot issue phone verification token without valid phone");
  }

  return jwt.sign(
    { typ: "phone_verified", phone: mobileNormalized },
    process.env.JWT_SECRET,
    { expiresIn },
  );
}

function assertPhoneVerificationToken(token, phone) {
  if (!token || typeof token !== "string") {
    return {
      ok: false,
      message: "Please verify your mobile number before continuing.",
    };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return {
      ok: false,
      message: "Phone verification expired. Please verify your mobile again.",
    };
  }

  if (decoded?.typ !== "phone_verified" || !decoded?.phone) {
    return { ok: false, message: "Invalid phone verification token." };
  }

  const verifiedPhone = normalize10(decoded.phone);
  const claimedPhone = normalize10(phone);
  if (!verifiedPhone || !claimedPhone || verifiedPhone !== claimedPhone) {
    return {
      ok: false,
      message:
        "Mobile number does not match the verified number. Please verify again.",
    };
  }

  return { ok: true, phone: verifiedPhone };
}

module.exports = {
  issuePhoneVerificationToken,
  assertPhoneVerificationToken,
  DEFAULT_TTL,
};
