// routes/schoolRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
  registerSchool,
  getSchoolsVerifiedPublic,
  getSchoolsForAdmin,
  getPlatformSchoolStats,
  getSchoolAdminSummary,
  getPlatformSchoolDetail,
  getSchoolsWithReviews,
  getSchoolWithReviews,
  sendOtp,
  verifyOtp,
  updateVerification,
  updatePaidLeaveCount,
  getMySchool,
  getSchoolListing,
  updateSchoolListing,
  updateSchoolGallery,
  removeGalleryImage,
} = require("../controllers/schoolController");
const subscriptionController = require("../controllers/subscriptionController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const adminAuth = () => roleCheck(["admin", "school_admin"]);

// simple disk storage for uploads (ensure uploads/ exists)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "..", "uploads"));
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const GALLERY_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const galleryFileFilter = (req, file, cb) => {
  if (file.fieldname !== "gallery") {
    return cb(null, true);
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!GALLERY_EXTENSIONS.has(ext)) {
    return cb(
      new Error("Gallery only accepts JPG, PNG, WebP, or GIF images"),
      false
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: galleryFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const handleUploadError = (middleware) => {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || "File upload failed",
        });
      }
      next();
    });
  };
};

// Public registration endpoint (handles file uploads)
router.post(
  "/register",
  handleUploadError(
    upload.fields([
      { name: "registrationCertificate", maxCount: 1 },
      { name: "affiliationCertificate", maxCount: 1 },
      { name: "principalIdProof", maxCount: 1 },
      { name: "gallery", maxCount: 10 }, // Gallery images (max 10)
    ])
  ),
  registerSchool
);

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// Public directory: only approved (Verified) schools
router.get("/", getSchoolsVerifiedPublic);

router.get("/discover", getSchoolsWithReviews); // public route for school discovery with reviews
router.get("/discover/:id", getSchoolWithReviews); // public route for single school detail with reviews

// Platform admin (full school list & stats — not public)
router.get(
  "/admin/stats",
  protect,
  roleCheck(["admin"]),
  getPlatformSchoolStats
);
router.get(
  "/admin/:schoolId/summary",
  protect,
  roleCheck(["admin"]),
  getSchoolAdminSummary
);
router.get(
  "/admin/:schoolId/detail",
  protect,
  roleCheck(["admin"]),
  getPlatformSchoolDetail
);
router.get("/admin", protect, roleCheck(["admin"]), getSchoolsForAdmin);

// Admin: update verification / approval status
router.patch(
  "/:id/verification",
  protect,
  roleCheck(["admin"]),
  updateVerification
);

// School admin: get school details
router.get("/my-school", protect, adminAuth(), getMySchool);

router.post(
  "/:id/create-pending-checkout",
  protect,
  adminAuth(),
  subscriptionController.createPendingStudentsCheckout
);

// School admin: update paid leave count
router.put("/paid-leave-count", protect, adminAuth(), updatePaidLeaveCount);

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: galleryFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// School admin: manage school listing
router.get("/listing", protect, adminAuth(), getSchoolListing);
router.put("/listing", protect, adminAuth(), updateSchoolListing);
router.post(
  "/listing/gallery",
  protect,
  adminAuth(),
  handleUploadError(memoryUpload.array("gallery", 10)),
  updateSchoolGallery
);
router.delete("/listing/gallery", protect, adminAuth(), removeGalleryImage);

module.exports = router;
