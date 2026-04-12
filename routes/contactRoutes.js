const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const contactController = require("../controllers/contactController");

router.post("/", contactController.create);
router.get("/admin/all", protect, roleCheck(["admin"]), contactController.listAdmin);
router.patch("/:id", protect, roleCheck(["admin"]), contactController.updateStatus);

module.exports = router;
