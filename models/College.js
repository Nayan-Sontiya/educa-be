// models/College.js
const mongoose = require("mongoose");

const collegeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [150, "College name cannot exceed 150 characters"],
    },
    officialEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    representative: {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      designation: {
        type: String,
        required: true,
        trim: true,
      },
    },
    verificationStatus: {
      type: String,
      enum: ["Pending", "Verified", "Rejected", "Blocked"],
      default: "Pending",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    reviewNote: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("College", collegeSchema);
