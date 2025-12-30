const express = require("express");
const router = express.Router();
const subjectCtrl = require("../controllers/subjectController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);

// SUBJECT ROUTES
router.get("/:classId", protect, auth(), subjectCtrl.getSubjectsByClass);
router.get("/", protect, auth(), subjectCtrl.getSubjects);
router.post("/", protect, auth(), subjectCtrl.addSubject);
router.put("/:subjectId", protect, auth(), subjectCtrl.updateSubject);
router.delete("/:subjectId", protect, auth(), subjectCtrl.deleteSubject);

module.exports = router;
