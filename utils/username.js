/**
 * Usernames are unique across the entire platform (all schools), not per school.
 * MongoDB enforces this with a sparse unique index on `users.username`.
 *
 * We store usernames trimmed and lowercased so the same logical name cannot be
 * registered twice with different casing (e.g. Ali vs ali).
 */
function normalizeUsername(input) {
  if (input == null) return "";
  return String(input).trim().toLowerCase();
}

/**
 * Convert a free-text name into a slug-like token (alphanumeric + underscore only).
 * e.g. "Rahul Kumar" → "rahulkumar"
 */
function slugName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
}

/**
 * Generate candidate usernames based on student name, parent name, and phone.
 * Returns all candidates (including taken ones); caller filters by availability.
 *
 * Priority format (shown as recommendation in UI):
 *   {student first word} + {first letter of parent name} + {first 4 of phone}
 *   e.g.  Rahul Kumar / Amit / 9876543210  →  rahula9876
 */
function buildUsernameVariants(studentName, parentName, phone) {
  const digits  = String(phone || "").replace(/\D/g, "");
  const ph4     = digits.slice(0, 4);   // FIRST 4 of phone (matches UI hint)
  const ph4last = digits.slice(-4);     // last 4 as fallback
  const ph6     = digits.slice(-6);

  // Student: first word only (the "first name")
  const sWords  = slugName(studentName).split(/\s+/); // slugName removes spaces already
  const sAll    = slugName(studentName);               // full slug (no spaces)
  const sFirst  = sAll.slice(0, 10);                   // up to first 10 chars
  const sWord1  = (studentName || "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim().split(/\s+/)[0] || sFirst;

  const pSlug   = slugName(parentName);
  const pLetter = pSlug.charAt(0);     // first letter of parent name
  const pFirst4 = pSlug.slice(0, 4);

  const seen = new Set();
  const variants = [];
  const add = (v) => {
    const n = normalizeUsername(v);
    if (n && n.length >= 4 && !seen.has(n)) {
      seen.add(n);
      variants.push(n);
    }
  };

  // 1️⃣ Primary recommended format: firstname + parent_first_letter + phone_first4
  if (sWord1 && pLetter && ph4)  add(`${sWord1}${pLetter}${ph4}`);

  // Fallbacks & alternatives
  if (sWord1 && pLetter && ph4last && ph4last !== ph4) add(`${sWord1}${pLetter}${ph4last}`);
  if (sFirst && ph4)             add(`${sFirst}${ph4}`);
  if (sFirst && ph6)             add(`${sFirst}${ph6}`);
  if (sFirst && pFirst4)         add(`${sFirst}${pFirst4}`);
  if (sFirst && pFirst4 && ph4)  add(`${sFirst}${pFirst4}${ph4}`);
  if (pSlug && ph4)              add(`${pSlug}${ph4}`);
  if (sFirst)                    add(`${sFirst}01`);
  if (sFirst)                    add(`${sFirst}99`);
  if (sFirst && pLetter && ph4last) add(`${sFirst}${pLetter}${ph4last}`);

  return variants;
}

/**
 * Return up to `limit` usernames that are NOT already in the User collection.
 */
async function suggestAvailableUsernames(User, studentName, parentName, phone, limit = 5) {
  const candidates = buildUsernameVariants(studentName, parentName, phone);
  if (!candidates.length) return [];

  const taken = await User.find({ username: { $in: candidates } })
    .select("username")
    .lean();
  const takenSet = new Set(taken.map((u) => u.username));

  return candidates.filter((c) => !takenSet.has(c)).slice(0, limit);
}

module.exports = { normalizeUsername, buildUsernameVariants, suggestAvailableUsernames };
