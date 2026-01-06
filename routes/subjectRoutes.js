const express = require("express");
const router = express.Router();
const subjectCtrl = require("../controllers/subjectController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);
const teacherAuth = () => roleCheck(["admin", "school_admin", "teacher"]);

// SUBJECT ROUTES
// Get subjects by class - allow teachers
router.get("/class/:classId", protect, teacherAuth(), subjectCtrl.getSubjectsByClass);
// Get all school subjects - allow teachers
router.get("/", protect, teacherAuth(), subjectCtrl.getSubjects);
// Assign subjects to class - allow teachers
router.post("/assign-to-class", protect, teacherAuth(), subjectCtrl.assignSubjectsToClass);
// Unassign subjects from class - allow teachers
router.post("/unassign-from-class", protect, teacherAuth(), subjectCtrl.unassignSubjectsFromClass);
// Admin only routes
router.post("/", protect, auth(), subjectCtrl.addSubject);
router.put("/:subjectId", protect, auth(), subjectCtrl.updateSubject);
router.delete("/:subjectId", protect, auth(), subjectCtrl.deleteSubject);

module.exports = router;
