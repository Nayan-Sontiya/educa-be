const express = require("express");
const router = express.Router();
const classCtrl = require("../controllers/classController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);

// CLASS ROUTES
router.get("/", protect, auth(), classCtrl.getClasses);
router.post("/", protect, auth(), classCtrl.addClass);
router.patch("/:classId/status", protect, auth(), classCtrl.updateClassStatus);
router.delete("/:classId", protect, auth(), classCtrl.deleteClass);

module.exports = router;
