// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { registerUser, loginUser, logoutUser } = require("../controllers/authController");
const protect = require("../middleware/authMiddleware");
const {
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  forgotPasswordReset,
  changePassword,
} = require("../controllers/passwordController");
const {
  sendSignupOtp,
  verifySignupOtp,
} = require("../controllers/signupOtpController");

// Register endpoints - both /register and /signup for compatibility
router.post("/register", registerUser);
router.post("/signup", registerUser); // Alias for register (used by frontend)

router.post("/login", loginUser);
router.post("/logout", logoutUser);

// Mobile-number OTP verification for public signup (e.g. teacher self-register)
router.post("/signup/send-otp", sendSignupOtp);
router.post("/signup/verify-otp", verifySignupOtp);

router.post("/forgot-password/send-otp", forgotPasswordSendOtp);
router.post("/forgot-password/verify-otp", forgotPasswordVerifyOtp);
router.post("/forgot-password/reset", forgotPasswordReset);
router.post("/change-password", protect, changePassword);

module.exports = router;
