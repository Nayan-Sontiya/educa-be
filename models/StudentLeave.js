// models/StudentLeave.js
// Parent-applied leave for a student (reviewed by class teacher)
const mongoose = require("mongoose");

const studentLeaveSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    teacherUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    days: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

studentLeaveSchema.index({ studentId: 1, status: 1 });
studentLeaveSchema.index({ teacherUserId: 1, status: 1 });
studentLeaveSchema.index({ parentUserId: 1, createdAt: -1 });
studentLeaveSchema.index({ schoolId: 1, status: 1 });

module.exports = mongoose.model("StudentLeave", studentLeaveSchema);
