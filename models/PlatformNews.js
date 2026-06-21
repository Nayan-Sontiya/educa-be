const mongoose = require("mongoose");
const { normalizeStoredMediaPath } = require("../utils/platformNewsMedia");

const platformNewsSchema = new mongoose.Schema(
  {
    caption: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    mediaType: {
      type: String,
      enum: ["none", "image", "video"],
      default: "none",
    },
    mediaUrl: {
      type: String,
      default: "",
      trim: true,
    },
    published: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    authorName: {
      type: String,
      default: "UtthanAI",
      trim: true,
    },
  },
  { timestamps: true }
);

platformNewsSchema.index({ published: 1, publishedAt: -1 });

platformNewsSchema.pre("save", function normalizeMediaOnSave(next) {
  if (this.mediaType === "none") {
    this.mediaUrl = "";
    return next();
  }
  if (this.mediaUrl) {
    this.mediaUrl = normalizeStoredMediaPath(this.mediaUrl);
  }
  next();
});

module.exports = mongoose.model("PlatformNews", platformNewsSchema);
