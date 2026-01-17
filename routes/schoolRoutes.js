// routes/schoolRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
  registerSchool,
  getSchools,
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

const upload = multer({ storage });

// Public registration endpoint (handles file uploads)
router.post(
  "/register",
  upload.fields([
    { name: "registrationCertificate", maxCount: 1 },
    { name: "affiliationCertificate", maxCount: 1 },
    { name: "principalIdProof", maxCount: 1 },
  ]),
  registerSchool
);

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

router.get("/", getSchools); // public route for listing schools
router.get("/discover", getSchoolsWithReviews); // public route for school discovery with reviews
router.get("/discover/:id", getSchoolWithReviews); // public route for single school detail with reviews

// Admin: update verification status
router.patch(
  "/:id/verification",
  protect,
  roleCheck(["admin"]),
  updateVerification
);

// School admin: get school details
router.get("/my-school", protect, adminAuth(), getMySchool);

// School admin: update paid leave count
router.put("/paid-leave-count", protect, adminAuth(), updatePaidLeaveCount);

// School admin: manage school listing
router.get("/listing", protect, adminAuth(), getSchoolListing);
router.put("/listing", protect, adminAuth(), updateSchoolListing);
router.post(
  "/listing/gallery",
  protect,
  adminAuth(),
  upload.array("gallery", 10),
  updateSchoolGallery
);
router.delete("/listing/gallery", protect, adminAuth(), removeGalleryImage);

module.exports = router;
