// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const {
  getUsers,
  assignSchool,
  updateUserRole,
} = require("../controllers/userController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");

// ✅ Get all users (admin-only)
router.get("/", protect, roleCheck(["admin"]), getUsers);

// ✅ Assign a user to a school (admin)
router.post("/assign-school", protect, roleCheck(["admin"]), assignSchool);

// ✅ Update user role (admin)
router.put("/update-role/:id", protect, roleCheck(["admin"]), updateUserRole);

module.exports = router;
