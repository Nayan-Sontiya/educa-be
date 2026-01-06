const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  assignTeacher,
  unassignTeacher,
  getAssignments,
  getMyAssignments,
  getAssignmentsByClassSection,
} = require("../controllers/teacherAssignmentController");

router.post("/", protect, roleCheck(["school_admin"]), assignTeacher);
router.delete("/:id", protect, roleCheck(["school_admin"]), unassignTeacher);
router.get("/", protect, roleCheck(["school_admin"]), getAssignments);
router.get("/me", protect, roleCheck(["teacher"]), getMyAssignments);
router.get(
  "/by-class/:classSectionId",
  protect,
  roleCheck(["school_admin"]),
  getAssignmentsByClassSection
);

module.exports = router;
