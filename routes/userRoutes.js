// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const {
  getUsers,
  assignSchool,
  updateUserRole,
  getCurrentUser,
  updateCurrentUser,
} = require("../controllers/userController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");

// ✅ Get current user profile
router.get("/me", protect, getCurrentUser);

// ✅ Update current user profile
router.put("/me", protect, updateCurrentUser);

// ✅ Get all users (admin-only)
router.get("/", protect, roleCheck(["admin"]), getUsers);

// ✅ Assign a user to a school (admin)
router.post("/assign-school", protect, roleCheck(["admin"]), assignSchool);

// ✅ Update user role (admin)
router.put("/update-role/:id", protect, roleCheck(["admin"]), updateUserRole);

module.exports = router;
