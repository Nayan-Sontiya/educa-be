// routes/reviewRoutes.js
const express = require("express");
const router = express.Router();
const {
  getAllReviews,
  getReviewById,
  replyToReview,
  updateReply,
  getReviewAnalytics,
  flagReview,
  getPublicReviews,
  createReview,
} = require("../controllers/reviewController");
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const adminAuth = () => roleCheck(["admin", "school_admin"]);

// Public routes
router.get("/public/:schoolId", getPublicReviews);
router.post("/", protect, createReview); // Authenticated: Create a review (for parents/students) - reviewerType from token

// Admin routes (require authentication)
router.get("/", protect, adminAuth(), getAllReviews);
router.get("/analytics", protect, adminAuth(), getReviewAnalytics);
router.get("/:id", protect, adminAuth(), getReviewById);
router.post("/:id/reply", protect, adminAuth(), replyToReview);
router.put("/:id/reply", protect, adminAuth(), updateReply);
router.post("/:id/flag", protect, adminAuth(), flagReview);

module.exports = router;
