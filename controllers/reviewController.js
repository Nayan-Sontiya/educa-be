// controllers/reviewController.js
const Review = require("../models/Review");
const School = require("../models/School");

// Get all reviews for a school (admin only)
exports.getAllReviews = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const {
      rating,
      status,
      startDate,
      endDate,
      category,
      search,
      page = 1,
      limit = 10,
    } = req.query;

    const query = { schoolId };

    // Filter by rating
    if (rating) {
      query.rating = parseInt(rating);
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Search in review text or reviewer name
    if (search) {
      query.$or = [
        { reviewText: { $regex: search, $options: "i" } },
        { reviewerName: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("reply.repliedBy", "name email")
      .lean();

    const total = await Review.countDocuments(query);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching reviews",
    });
  }
};

// Get single review by ID
exports.getReviewById = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;

    const review = await Review.findOne({ _id: id, schoolId })
      .populate("reply.repliedBy", "name email")
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    res.json({
      success: true,
      data: review,
    });
  } catch (error) {
    console.error("Error fetching review:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching review",
    });
  }
};

// Reply to a review
exports.replyToReview = async (req, res) => {
  try {
    const { schoolId, userId } = req.user;
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply text is required",
      });
    }

    const review = await Review.findOne({ _id: id, schoolId });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.reply = {
      text: text.trim(),
      repliedAt: new Date(),
      repliedBy: userId,
    };
    review.status = "replied";
    await review.save();

    const populatedReview = await Review.findById(review._id)
      .populate("reply.repliedBy", "name email")
      .lean();

    res.json({
      success: true,
      data: populatedReview,
      message: "Reply added successfully",
    });
  } catch (error) {
    console.error("Error replying to review:", error);
    res.status(500).json({
      success: false,
      message: "Error replying to review",
    });
  }
};

// Update reply
exports.updateReply = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply text is required",
      });
    }

    const review = await Review.findOne({ _id: id, schoolId });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    if (!review.reply || !review.reply.text) {
      return res.status(400).json({
        success: false,
        message: "No existing reply found",
      });
    }

    review.reply.text = text.trim();
    await review.save();

    const populatedReview = await Review.findById(review._id)
      .populate("reply.repliedBy", "name email")
      .lean();

    res.json({
      success: true,
      data: populatedReview,
      message: "Reply updated successfully",
    });
  } catch (error) {
    console.error("Error updating reply:", error);
    res.status(500).json({
      success: false,
      message: "Error updating reply",
    });
  }
};

// Get review analytics
exports.getReviewAnalytics = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const stats = await Review.getAverageRating(schoolId);

    // Get category distribution
    const categoryStats = await Review.aggregate([
      { $match: { schoolId, status: { $ne: "hidden" } } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    const categoryDistribution = {};
    categoryStats.forEach((cat) => {
      categoryDistribution[cat._id] = cat.count;
    });

    // Get rating trends over time (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const trends = await Review.aggregate([
      {
        $match: {
          schoolId,
          status: { $ne: "hidden" },
          createdAt: { $gte: twelveMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          averageRating: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    res.json({
      success: true,
      data: {
        ...stats,
        categoryDistribution,
        trends,
        newReviews: await Review.countDocuments({
          schoolId,
          status: "new",
        }),
        repliedReviews: await Review.countDocuments({
          schoolId,
          status: "replied",
        }),
      },
    });
  } catch (error) {
    console.error("Error fetching review analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching review analytics",
    });
  }
};

// Flag a review for moderation
exports.flagReview = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const { reason } = req.body;

    const review = await Review.findOne({ _id: id, schoolId });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.isFlagged = true;
    review.flagReason = reason || "other";
    await review.save();

    res.json({
      success: true,
      message: "Review flagged for moderation",
    });
  } catch (error) {
    console.error("Error flagging review:", error);
    res.status(500).json({
      success: false,
      message: "Error flagging review",
    });
  }
};

// Create a review (authenticated - for parents/students)
exports.createReview = async (req, res) => {
  try {
    const { id: userId, role } = req.user; // From JWT token: id = user._id, role = user.role
    const {
      schoolId,
      reviewerName,
      reviewerType, // Optional - will be overridden by role from token
      reviewerClass,
      rating,
      reviewText,
      category = "other",
    } = req.body;

    // Validation
    if (!schoolId || !rating || !reviewText) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: schoolId, rating, and reviewText are required",
      });
    }

    if (![1, 2, 3, 4, 5].includes(parseInt(rating))) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    // Only parents can create reviews (students are not separate users in the system)
    if (role !== "parent") {
      return res.status(403).json({
        success: false,
        message: "Only parents can create reviews",
      });
    }

    // Automatically determine reviewerType from user role
    // Map user role to reviewer type
    let finalReviewerType;
    if (role === "parent") {
      finalReviewerType = "parent";
    } else {
      // Fallback: use provided reviewerType if role mapping fails
      finalReviewerType = reviewerType || "parent";
    }

    // Verify school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Get user details for reviewer name
    const User = require("../models/User");
    const user = await User.findById(userId).select("name email").lean();
    const finalReviewerName = reviewerName?.trim() || user?.name || "Anonymous";

    // Create review
    const review = await Review.create({
      schoolId,
      reviewerName: finalReviewerName,
      reviewerType: finalReviewerType,
      reviewerClass: reviewerClass?.trim(),
      rating: parseInt(rating),
      reviewText: reviewText.trim(),
      category,
      status: "new",
    });

    res.status(201).json({
      success: true,
      data: review,
      message: "Review submitted successfully",
    });
  } catch (error) {
    console.error("Error creating review:", error);
    res.status(500).json({
      success: false,
      message: "Error creating review",
    });
  }
};

// Public endpoint: Get reviews for a school (for school listing page)
exports.getPublicReviews = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const query = {
      schoolId,
      status: { $in: ["new", "replied"] },
      isFlagged: false,
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("reply.repliedBy", "name email")
      .select("-isFlagged -flagReason")
      .lean();

    const total = await Review.countDocuments(query);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching public reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching reviews",
    });
  }
};
