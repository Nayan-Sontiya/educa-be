// models/ParentAlert.js
const mongoose = require("mongoose");

const parentAlertSchema = new mongoose.Schema(
  {
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
    },
    type: {
      type: String,
      enum: ["absence", "leave"],
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["unread", "read"],
      default: "unread",
    },
    message: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
parentAlertSchema.index({ parentUserId: 1, status: 1 });
parentAlertSchema.index({ studentId: 1, date: 1 });

module.exports = mongoose.model("ParentAlert", parentAlertSchema);
