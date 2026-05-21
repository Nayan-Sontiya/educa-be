const Student = require("../models/Student");

const PENDING_ACTIVATION_MESSAGE =
  "Your child's account is pending activation by the school. You can sign in after the school completes payment for this seat.";

const PENDING_ACTIVATION_CODE = "STUDENT_PENDING_ACTIVATION";

/**
 * Parent may log in only if they have at least one active (activated) student enrollment.
 * Pending-seat students (status pending) must not access the app until the school pays.
 */
async function assertParentCanAuthenticate(parentUserId) {
  if (!parentUserId) {
    return { allowed: true };
  }

  const total = await Student.countDocuments({ parentUserId });
  if (total === 0) {
    return { allowed: true };
  }

  const activeCount = await Student.countDocuments({
    parentUserId,
    status: "active",
  });

  if (activeCount > 0) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: PENDING_ACTIVATION_MESSAGE,
    code: PENDING_ACTIVATION_CODE,
  };
}

module.exports = {
  assertParentCanAuthenticate,
  PENDING_ACTIVATION_MESSAGE,
  PENDING_ACTIVATION_CODE,
};
