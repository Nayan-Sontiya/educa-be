// models/ClassSubject.js
const mongoose = require("mongoose");

const classSubjectSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    classSectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassSection",
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Ensure unique combination of classSection and subject
classSubjectSchema.index(
  { classSectionId: 1, subjectId: 1 },
  { unique: true }
);

module.exports = mongoose.model("ClassSubject", classSubjectSchema);

