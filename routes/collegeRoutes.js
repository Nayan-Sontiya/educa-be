// routes/collegeRoutes.js
const express = require("express");
const router = express.Router();
const {
  registerCollege,
  getAllColleges,
  getCollegeById,
  updateCollegeStatus,
  getCollegeMe,
} = require("../controllers/collegeController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");

const adminOnly = roleCheck(["admin"]);

// Public college registration endpoint
router.post("/register", registerCollege);

// Super Admin endpoints
router.get("/admin", protect, adminOnly, getAllColleges);
router.patch("/:id/status", protect, adminOnly, updateCollegeStatus);

// College Admin profile endpoint
router.get("/me", protect, getCollegeMe);

// Single college detail endpoint
router.get("/:id", protect, getCollegeById);

module.exports = router;
