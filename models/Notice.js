// models/Notice.js
const mongoose = require("mongoose");

const noticeSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
    },
    type: {
      type: String,
      enum: ["Holiday", "Event", "Emergency", "Exam", "Fees", "General"],
      default: "General",
      required: true,
    },
    targetAudience: {
      type: String,
      enum: ["All", "Teachers Only", "Students Only", "Specific Class"],
      default: "All",
      required: true,
    },
    classSectionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ClassSection",
      },
    ],
    attachments: [
      {
        fileName: String,
        fileUrl: String,
        fileType: String, // 'image' or 'pdf'
        fileSize: Number, // in bytes
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    publishDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["draft", "published", "unpublished", "expired"],
      default: "draft",
      index: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    isAcknowledgeRequired: {
      type: Boolean,
      default: false,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    views: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    acknowledgements: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        acknowledgedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
noticeSchema.index({ schoolId: 1, status: 1 });
noticeSchema.index({ schoolId: 1, publishDate: -1 });
noticeSchema.index({ schoolId: 1, isPinned: -1, publishDate: -1 });
noticeSchema.index({ expiryDate: 1 });

// Middleware to automatically set status to expired
noticeSchema.pre("save", function (next) {
  if (this.expiryDate && new Date() > this.expiryDate && this.status === "published") {
    this.status = "expired";
  }
  next();
});

// Static method to find active notices for a school
noticeSchema.statics.findActiveNotices = function (schoolId, targetAudience, classSectionId = null) {
  const now = new Date();

  const classIdValid =
    classSectionId && mongoose.Types.ObjectId.isValid(String(classSectionId));

  // Audience filter (combined with expiry via $and so a second $or does not overwrite expiry)
  let audienceCondition;

  if (targetAudience === "All") {
    audienceCondition = { targetAudience: "All" };
  } else if (targetAudience === "Teachers Only") {
    audienceCondition = { $or: [{ targetAudience: "All" }, { targetAudience: "Teachers Only" }] };
  } else if (targetAudience === "Students Only") {
    const ors = [{ targetAudience: "All" }, { targetAudience: "Students Only" }];
    if (classIdValid) {
      ors.push({
        targetAudience: "Specific Class",
        classSectionIds: classSectionId,
      });
    }
    audienceCondition = { $or: ors };
  } else if (targetAudience === "Specific Class" && classIdValid) {
    audienceCondition = {
      $or: [
        { targetAudience: "All" },
        {
          targetAudience: "Specific Class",
          classSectionIds: classSectionId,
        },
      ],
    };
  } else {
    audienceCondition = { targetAudience: "All" };
  }

  const query = {
    schoolId,
    status: "published",
    publishDate: { $lte: now },
    $and: [
      { $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] },
      audienceCondition,
    ],
  };

  return this.find(query)
    .sort({ isPinned: -1, publishDate: -1 })
    .populate("createdBy", "name email")
    .populate("classSectionIds", "className sectionName");
};

// Instance method to track view
noticeSchema.methods.trackView = function (userId) {
  // Check if user has already viewed
  const existingView = this.views.find(
    (view) => view.userId.toString() === userId.toString()
  );

  if (!existingView) {
    this.views.push({ userId });
    this.viewCount += 1;
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to acknowledge
noticeSchema.methods.acknowledge = function (userId) {
  // Check if user has already acknowledged
  const existingAck = this.acknowledgements.find(
    (ack) => ack.userId.toString() === userId.toString()
  );

  if (!existingAck) {
    this.acknowledgements.push({ userId });
    return this.save();
  }
  return Promise.resolve(this);
};

module.exports = mongoose.model("Notice", noticeSchema);

