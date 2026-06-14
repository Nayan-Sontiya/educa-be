/** Parent app install link (override via PARENT_APP_PLAY_STORE_URL). */
const PARENT_APP_PLAY_STORE_URL =
  process.env.PARENT_APP_PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.utthanai.app";

/**
 * DLT template variable order for parent credential SMS.
 * Must match {#var#} order in your approved DLT template, e.g.:
 * "UtthanAI login for {#var#}, student {#var#}. User:{#var#} Pass:{#var#} App:{#var#}"
 */
function buildParentCredentialsDltVariables({
  schoolName,
  studentName,
  classSectionLabel,
  username,
  password,
}) {
  const studentLine = classSectionLabel
    ? `${studentName} (${classSectionLabel})`
    : studentName;

  return [
    String(schoolName || "School").trim(),
    studentLine,
    String(username || "").trim(),
    String(password || "").trim(),
    PARENT_APP_PLAY_STORE_URL,
  ];
}

/**
 * Human-readable SMS (for admin fallback emails only — not sent via SMS API).
 */
function buildParentLoginSmsMessage({
  schoolName,
  studentName,
  classSectionLabel,
  username,
  password,
}) {
  const studentLine = classSectionLabel
    ? `Student: ${studentName} (${classSectionLabel})`
    : `Student: ${studentName}`;
  return (
    `UtthanAI Login\n` +
    `School: ${schoolName}\n` +
    `${studentLine}\n` +
    `Username: ${username}\n` +
    `Password: ${password}\n` +
    `Get the app: ${PARENT_APP_PLAY_STORE_URL}`
  );
}

module.exports = {
  PARENT_APP_PLAY_STORE_URL,
  buildParentCredentialsDltVariables,
  buildParentLoginSmsMessage,
};
