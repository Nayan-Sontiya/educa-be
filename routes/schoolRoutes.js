// routes/schoolRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
  registerSchool,
  getSchools,
  sendOtp,
  verifyOtp,
  updateVerification,
} = require("../controllers/schoolController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");

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

// Admin: update verification status
router.patch(
  "/:id/verification",
  protect,
  roleCheck(["admin"]),
  updateVerification
);

module.exports = router;
