/**
 * Human-readable API message when a school is not allowed to use the platform.
 * Shared by login and JWT protect middleware.
 */
function schoolAccessMessage(school) {
  if (!school) return "School access is not available yet.";
  const byStatus = {
    Pending:
      "Your school is pending platform approval. You will be able to sign in after approval.",
    Rejected: school.rejectionReason
      ? `School registration was rejected: ${school.rejectionReason}`
      : "School registration was rejected. Contact support if you need help.",
    Blocked: "This school has been blocked. Contact platform support.",
    Suspended: "This school is temporarily suspended. Contact platform support.",
    NeedMoreInfo: school.reviewNote
      ? `More information is required: ${school.reviewNote}`
      : "More information is required before your school can be approved. Contact support.",
  };
  return (
    byStatus[school.verificationStatus] || "School access is not available yet."
  );
}

module.exports = { schoolAccessMessage };
