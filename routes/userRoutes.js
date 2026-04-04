// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const {
  getUsers,
  assignSchool,
  updateUserRole,
  getCurrentUser,
  updateCurrentUser,
  requestContactChangeOtp,
  verifyContactChangeOtp,
  getUserById,
  adminPatchUser,
  adminDeleteUser,
  adminResetPassword,
} = require("../controllers/userController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");

// ✅ Get current user profile
router.get("/me", protect, getCurrentUser);

// ✅ Update current user profile
router.put("/me", protect, updateCurrentUser);
router.post("/me/contact-change/request-otp", protect, requestContactChangeOtp);
router.post("/me/contact-change/verify-otp", protect, verifyContactChangeOtp);

// ✅ Get all users (admin-only)
router.get("/", protect, roleCheck(["admin"]), getUsers);

// ✅ Assign a user to a school (admin)
router.post("/assign-school", protect, roleCheck(["admin"]), assignSchool);

// ✅ Update user role (admin)
router.put("/update-role/:id", protect, roleCheck(["admin"]), updateUserRole);

router.post(
  "/:id/reset-password",
  protect,
  roleCheck(["admin"]),
  adminResetPassword
);
router.get("/:id", protect, roleCheck(["admin"]), getUserById);
router.patch("/:id", protect, roleCheck(["admin"]), adminPatchUser);
router.delete("/:id", protect, roleCheck(["admin"]), adminDeleteUser);

module.exports = router;
