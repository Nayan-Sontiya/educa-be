// routes/calendarRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getStudentCalendar,
  getSchoolCalendarEvents,
  createSchoolCalendarEvent,
  updateSchoolCalendarEvent,
  deleteSchoolCalendarEvent,
} = require("../controllers/calendarController");

// Get student calendar (for parent/student)
router.get(
  "/student",
  protect,
  roleCheck(["parent", "teacher", "school_admin"]),
  getStudentCalendar
);

// Get school calendar events (for admin/teacher)
router.get(
  "/school-events",
  protect,
  roleCheck(["teacher", "school_admin", "admin"]),
  getSchoolCalendarEvents
);

// Create school calendar event (admin only)
router.post(
  "/school-events",
  protect,
  roleCheck(["school_admin", "admin"]),
  createSchoolCalendarEvent
);

// Update school calendar event (admin only)
router.put(
  "/school-events/:id",
  protect,
  roleCheck(["school_admin", "admin"]),
  updateSchoolCalendarEvent
);

// Delete school calendar event (admin only)
router.delete(
  "/school-events/:id",
  protect,
  roleCheck(["school_admin", "admin"]),
  deleteSchoolCalendarEvent
);

module.exports = router;
