const express = require("express");
const router = express.Router();
const subjectCtrl = require("../controllers/subjectController");
const roleCheck = require("../middleware/roleMiddleware");
const auth = roleCheck(["admin", "school_admin"]);

// SUBJECT ROUTES
router.get("/:classId", auth, subjectCtrl.getSubjectsByClass);
router.post("/", auth, subjectCtrl.addSubject);
router.delete("/:subjectId", auth, subjectCtrl.deleteSubject);

module.exports = router;
