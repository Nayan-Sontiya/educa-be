// models/SchoolCalendarEvent.js
const mongoose = require("mongoose");

const schoolCalendarEventSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["holiday", "event", "exam", "ptm"],
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
    // If true, applies to all classes. If false, use classIds array
    appliesToAllClasses: {
      type: Boolean,
      default: true,
    },
    classIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Class",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for efficient queries by school and date range
schoolCalendarEventSchema.index({ schoolId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("SchoolCalendarEvent", schoolCalendarEventSchema);
