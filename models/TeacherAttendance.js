// models/TeacherAttendance.js
// Teacher self check-in attendance with selfie + GPS
const mongoose = require("mongoose");

const teacherAttendanceSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    date: {
      type: Date, // stored as midnight local time YYYY-MM-DD
      required: true,
    },
    status: {
      type: String,
      enum: ["P", "A", "L"], // Present / Absent (auto) / Leave
      default: "A",
    },
    checkInTime: {
      type: Date, // full timestamp when selfie was submitted
    },
    selfieUrl: {
      type: String, // relative path served from /uploads/teacher-selfies/
    },
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    distanceFromSchool: {
      type: Number, // metres
    },
    markedBy: {
      type: String,
      enum: ["self", "auto", "admin"],
      default: "auto",
    },
  },
  { timestamps: true }
);

// One record per teacher per day
teacherAttendanceSchema.index({ teacherId: 1, date: 1 }, { unique: true });
teacherAttendanceSchema.index({ schoolId: 1, date: -1 });

module.exports = mongoose.model("TeacherAttendance", teacherAttendanceSchema);
