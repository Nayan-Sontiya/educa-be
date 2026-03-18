/** Digits only for matching mobile numbers across formats */
function normalizePhone(input) {
  if (!input) return "";
  return String(input).replace(/\D/g, "");
}

module.exports = { normalizePhone };
