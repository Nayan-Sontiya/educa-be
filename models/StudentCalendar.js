// models/StudentCalendar.js
const mongoose = require("mongoose");

// This model represents the read-only calendar view for students/parents
// It syncs from Attendance List and School Calendar Events
const studentCalendarSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      unique: true,
    },
    // Calendar entries are populated from:
    // 1. Attendance records (status: P/A/L)
    // 2. School calendar events (holidays, exams, PTMs, etc.)
    entries: [
      {
        date: {
          type: Date,
          required: true,
        },
        type: {
          type: String,
          enum: ["attendance", "school_event"],
          required: true,
        },
        // For attendance entries
        attendanceStatus: {
          type: String,
          enum: ["P", "A", "L"],
        },
        // For school event entries
        eventId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SchoolCalendarEvent",
        },
        eventTitle: String,
        eventType: {
          type: String,
          enum: ["holiday", "event", "exam", "ptm"],
        },
      },
    ],
  },
  { timestamps: true }
);

// Index for efficient date-based queries
studentCalendarSchema.index({ "entries.date": 1 });

module.exports = mongoose.model("StudentCalendar", studentCalendarSchema);
