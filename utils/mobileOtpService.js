/**
 * Phone helpers shared by signup / school registration flows.
 * OTP delivery is handled by Firebase Phone Auth on the client.
 */
const { normalizePhone } = require("./phone");

function maskPhone(p) {
  if (!p || p.length < 4) return "******";
  return `******${p.slice(-4)}`;
}

/** Normalize a phone to its last 10 digits. Returns "" if invalid. */
function normalize10(phone) {
  const digits = normalizePhone(phone || "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

module.exports = {
  normalize10,
  maskPhone,
};
