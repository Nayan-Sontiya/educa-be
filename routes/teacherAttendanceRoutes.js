// routes/teacherAttendanceRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const uploadSelfie = require("../middleware/uploadSelfie");
const {
  markAttendance,
  getTodayStatus,
  getMyAttendance,
  getAttendanceForAdmin,
  updateGeofence,
  getGeofence,
} = require("../controllers/teacherAttendanceController");

const teacherOnly = roleCheck(["teacher"]);
const adminOnly = roleCheck(["school_admin", "admin"]);

// Teacher: mark attendance (multipart – includes selfie file)
router.post("/mark", protect, teacherOnly, uploadSelfie.single("selfie"), markAttendance);

// Teacher: check today's status
router.get("/today", protect, teacherOnly, getTodayStatus);

// Teacher: my attendance history
router.get("/my", protect, teacherOnly, getMyAttendance);

// Admin: view all teachers' attendance for a date
router.get("/admin", protect, adminOnly, getAttendanceForAdmin);

// Admin: configure / view school geofence
router.get("/school-geofence", protect, adminOnly, getGeofence);
router.patch("/school-geofence", protect, adminOnly, updateGeofence);

module.exports = router;
