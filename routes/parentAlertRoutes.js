// routes/parentAlertRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getParentAlerts,
  markAlertAsRead,
  markAllAlertsAsRead,
  getUnreadAlertCount,
} = require("../controllers/parentAlertController");

// Get all alerts for parent
router.get("/", protect, roleCheck(["parent"]), getParentAlerts);

// Get unread alert count
router.get("/unread-count", protect, roleCheck(["parent"]), getUnreadAlertCount);

// Mark alert as read
router.put("/:id/read", protect, roleCheck(["parent"]), markAlertAsRead);

// Mark all alerts as read
router.put("/read-all", protect, roleCheck(["parent"]), markAllAlertsAsRead);

module.exports = router;
