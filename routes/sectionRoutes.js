const express = require("express");
const router = express.Router();
const sectionCtrl = require("../controllers/sectionController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);

// SECTION ROUTES
router.get("/:classId", protect, auth(), sectionCtrl.getSectionsByClass);
router.get("/", protect, auth(), sectionCtrl.getSections);
router.post("/", protect, auth(), sectionCtrl.addSection);
router.delete("/:sectionId", protect, auth(), sectionCtrl.deleteSection);

module.exports = router;
