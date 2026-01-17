// models/Review.js
const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    reviewerName: {
      type: String,
      required: true,
      trim: true,
    },
    reviewerType: {
      type: String,
      enum: ["parent", "student"],
      required: true,
    },
    reviewerClass: {
      type: String,
      trim: true,
    }, // Optional: Class name if reviewer is a student
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    reviewText: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["new", "replied", "hidden"],
      default: "new",
      index: true,
    },
    reply: {
      text: {
        type: String,
        trim: true,
      },
      repliedAt: {
        type: Date,
      },
      repliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
    // Auto-moderation flags
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: {
      type: String,
      enum: ["abusive", "spam", "inappropriate", "other"],
    },
    // Analytics
    helpfulCount: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      enum: ["teaching", "facilities", "behavior", "management", "other"],
      default: "other",
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
reviewSchema.index({ schoolId: 1, status: 1 });
reviewSchema.index({ schoolId: 1, rating: 1 });
reviewSchema.index({ schoolId: 1, createdAt: -1 });
reviewSchema.index({ schoolId: 1, status: 1, rating: 1 });

// Static method to calculate average rating
reviewSchema.statics.getAverageRating = async function (schoolId) {
  const result = await this.aggregate([
    { $match: { schoolId, status: { $ne: "hidden" } } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: "$rating",
        },
      },
    },
  ]);

  if (!result || result.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  result[0].ratingDistribution.forEach((rating) => {
    ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
  });

  return {
    averageRating: Math.round(result[0].averageRating * 10) / 10,
    totalReviews: result[0].totalReviews,
    ratingDistribution,
  };
};

module.exports = mongoose.model("Review", reviewSchema);
