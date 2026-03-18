// routes/studentLeaveRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  applyLeave,
  getLeavesForStudent,
  getLeavesForTeacher,
  approveLeave,
  rejectLeave,
} = require("../controllers/studentLeaveController");

// Parent: apply leave for a child
router.post("/", protect, roleCheck(["parent"]), applyLeave);

// Parent: see leaves for a specific child
router.get(
  "/for-student/:studentId",
  protect,
  roleCheck(["parent"]),
  getLeavesForStudent
);

// Teacher: see all leave requests for their students (optional ?status=pending)
router.get(
  "/for-teacher",
  protect,
  roleCheck(["teacher"]),
  getLeavesForTeacher
);

// Teacher: approve a leave
router.patch(
  "/:id/approve",
  protect,
  roleCheck(["teacher"]),
  approveLeave
);

// Teacher: reject a leave
router.patch(
  "/:id/reject",
  protect,
  roleCheck(["teacher"]),
  rejectLeave
);

module.exports = router;
