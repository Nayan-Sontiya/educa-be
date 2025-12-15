const express = require("express");
const router = express.Router();
const sectionCtrl = require("../controllers/sectionController");
const roleCheck = require("../middleware/roleMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);

// SECTION ROUTES
router.get("/:classId", auth, sectionCtrl.getSectionsByClass);
router.post("/", auth, sectionCtrl.addSection);
router.delete("/:sectionId", auth, sectionCtrl.deleteSection);

module.exports = router;
