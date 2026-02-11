// routes/attendanceRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getAttendanceList,
  markAttendance,
  updateAttendance,
  getAttendanceStats,
} = require("../controllers/attendanceController");

// Get attendance list for a class section
router.get(
  "/list",
  protect,
  roleCheck(["teacher", "school_admin"]),
  getAttendanceList
);

// Mark attendance (bulk)
router.post(
  "/mark",
  protect,
  roleCheck(["teacher", "school_admin"]),
  markAttendance
);

// Update single attendance record
router.put(
  "/:id",
  protect,
  roleCheck(["teacher", "school_admin"]),
  updateAttendance
);

// Get attendance statistics
router.get(
  "/stats",
  protect,
  roleCheck(["teacher", "school_admin"]),
  getAttendanceStats
);

module.exports = router;
