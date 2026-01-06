const express = require("express");
const router = express.Router();
const leaveCtrl = require("../controllers/leaveController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const teacherAuth = () => roleCheck(["admin", "school_admin", "teacher"]);
const adminAuth = () => roleCheck(["admin", "school_admin"]);

// LEAVE ROUTES
// Teacher routes
router.post("/apply", protect, teacherAuth(), leaveCtrl.applyLeave);
router.get("/my-leaves", protect, teacherAuth(), leaveCtrl.getMyLeaves);
router.get("/stats", protect, teacherAuth(), leaveCtrl.getLeaveStats);

// Admin routes
router.get("/pending", protect, adminAuth(), leaveCtrl.getPendingLeaves);
router.get("/", protect, adminAuth(), leaveCtrl.getAllLeaves);
router.put("/:leaveId/approve", protect, adminAuth(), leaveCtrl.approveLeave);
router.put("/:leaveId/reject", protect, adminAuth(), leaveCtrl.rejectLeave);

module.exports = router;

