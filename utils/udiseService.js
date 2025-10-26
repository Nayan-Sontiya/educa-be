// utils/udiseService.js
// Simple stub for UDISE verification. Replace with real government API integration.
module.exports = {
  async verifyUdise(udiseCode) {
    // Dev stub: consider UDISE valid when it's 11-14 numeric characters.
    const valid = /^[0-9]{6,14}$/.test(udiseCode);
    if (!valid) return { valid: false };

    // Return mocked district/state for now.
    return {
      valid: true,
      district: "Mock District",
      state: "Mock State",
    };
  },
};
