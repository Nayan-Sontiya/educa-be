// routes/noticeRoutes.js
const express = require("express");
const router = express.Router();
const {
  createNotice,
  getAllNotices,
  getActiveNotices,
  getNoticeById,
  updateNotice,
  deleteNotice,
  trackView,
  acknowledgeNotice,
  getNoticeStats,
} = require("../controllers/noticeController");
const roleCheck = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const adminAuth = () => roleCheck(["admin", "school_admin"]);
const teacherAuth = () => roleCheck(["admin", "school_admin", "teacher"]);

// File upload route
router.post("/upload", protect, adminAuth(), upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    const uploadedFiles = req.files.map((file) => {
      // Construct file URL - use /api/uploads to match the static route
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const fileUrl = `${baseUrl}/uploads/${file.filename}`;
      
      // Determine file type
      let fileType = "pdf";
      if (file.mimetype.startsWith("image/")) {
        fileType = "image";
      } else if (file.mimetype === "application/pdf") {
        fileType = "pdf";
      }
      
      return {
        fileName: file.originalname,
        fileUrl: fileUrl,
        fileType: fileType,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
      };
    });

    res.status(200).json({
      success: true,
      data: uploadedFiles,
      message: "Files uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload files",
    });
  }
});

// Admin routes (require admin authentication)
router.post("/", protect, adminAuth(), createNotice);
router.get("/admin/all", protect, adminAuth(), getAllNotices);
router.get("/admin/stats", protect, adminAuth(), getNoticeStats);
router.get("/admin/:id", protect, adminAuth(), getNoticeById);
router.put("/admin/:id", protect, adminAuth(), updateNotice);
router.delete("/admin/:id", protect, adminAuth(), deleteNotice);

// User routes (for teachers, students, parents - active notices)
router.get("/active", protect, teacherAuth(), getActiveNotices);
router.get("/:id", protect, teacherAuth(), getNoticeById);
router.post("/:id/view", protect, teacherAuth(), trackView);
router.post("/:id/acknowledge", protect, teacherAuth(), acknowledgeNotice);

module.exports = router;

