// models/Attendance.js
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    classSectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassSection",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["P", "A", "L"], // P = Present, A = Absent, L = Leave
      required: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Ensure only one attendance entry per student per day
attendanceSchema.index(
  { studentId: 1, date: 1 },
  { unique: true }
);

// Index for efficient queries by class section and date
attendanceSchema.index({ classSectionId: 1, date: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
