/** Parent app install link (override via PARENT_APP_PLAY_STORE_URL). */
const PARENT_APP_PLAY_STORE_URL =
  process.env.PARENT_APP_PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.utthanai.app";

/**
 * SMS sent when a student is activated (immediately or after pending-seat payment).
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
  buildParentLoginSmsMessage,
};
