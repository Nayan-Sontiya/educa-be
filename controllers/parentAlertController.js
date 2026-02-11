// controllers/parentAlertController.js
const ParentAlert = require("../models/ParentAlert");
const Student = require("../models/Student");

// Get all alerts for logged-in parent
exports.getParentAlerts = async (req, res) => {
  try {
    const alerts = await ParentAlert.find({
      parentUserId: req.user.id,
    })
      .populate("studentId", "name")
      .populate("attendanceId", "date status")
      .sort({ createdAt: -1 });

    res.json({ data: alerts });
  } catch (error) {
    console.error("getParentAlerts error:", error);
    res.status(500).json({ message: "Error fetching parent alerts" });
  }
};

// Mark alert as read
exports.markAlertAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const alert = await ParentAlert.findById(id);
    if (!alert) {
      return res.status(404).json({ message: "Alert not found" });
    }

    if (alert.parentUserId.toString() !== req.user.id) {
      return res.status(403).json({
        message: "You are not allowed to update this alert",
      });
    }

    alert.status = "read";
    await alert.save();

    res.json({ message: "Alert marked as read", data: alert });
  } catch (error) {
    console.error("markAlertAsRead error:", error);
    res.status(500).json({ message: "Error updating alert" });
  }
};

// Mark all alerts as read
exports.markAllAlertsAsRead = async (req, res) => {
  try {
    await ParentAlert.updateMany(
      { parentUserId: req.user.id, status: "unread" },
      { status: "read" }
    );

    res.json({ message: "All alerts marked as read" });
  } catch (error) {
    console.error("markAllAlertsAsRead error:", error);
    res.status(500).json({ message: "Error updating alerts" });
  }
};

// Get unread alert count
exports.getUnreadAlertCount = async (req, res) => {
  try {
    const count = await ParentAlert.countDocuments({
      parentUserId: req.user.id,
      status: "unread",
    });

    res.json({ count });
  } catch (error) {
    console.error("getUnreadAlertCount error:", error);
    res.status(500).json({ message: "Error fetching alert count" });
  }
};
