const { assertEmailAvailable } = require("./emailUniqueness");

/**
 * Teacher signup / add-by-admin: email must be globally unique (all roles).
 * Duplicate mobile numbers are allowed.
 */
async function validateTeacherRegistrationAtSchool(_schoolId, email) {
  return assertEmailAvailable(email);
}

module.exports = {
  validateTeacherRegistrationAtSchool,
};
