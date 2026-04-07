/** Digits only for matching mobile numbers across formats */
function normalizePhone(input) {
  if (!input) return "";
  return String(input).replace(/\D/g, "");
}

/** First non-empty phone-like field from client payloads (RN / web / proxies). */
function pickPhoneFromBody(body) {
  if (!body || typeof body !== "object") return "";
  const keys = [
    "phone",
    "mobile",
    "phoneNumber",
    "mobileNumber",
    "contactPhone",
  ];
  for (const k of keys) {
    const v = body[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

module.exports = { normalizePhone, pickPhoneFromBody };
