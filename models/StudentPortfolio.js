const mongoose = require("mongoose");

const academicEntrySchema = new mongoose.Schema(
  {
    term: { type: String, trim: true }, // e.g. "Term 1 2025"
    subject: { type: String, required: true, trim: true },
    testName: { type: String, trim: true }, // e.g. "Unit Test 1"
    marksObtained: { type: Number },
    maxMarks: { type: Number },
    grade: { type: String, trim: true },
    remarks: { type: String, trim: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const behaviorEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    discipline: { type: String, trim: true }, // e.g. "Excellent", "Needs Improvement"
    attendanceBehavior: { type: String, trim: true },
    participation: { type: String, trim: true },
    socialInteraction: { type: String, trim: true },
    teacherComment: { type: String, trim: true },
  },
  { _id: false }
);

const skillEntrySchema = new mongoose.Schema(
  {
    area: {
      type: String,
      enum: [
        "communication",
        "leadership",
        "creativity",
        "sports",
        "technology",
        "other",
      ],
      required: true,
    },
    rating: { type: Number, min: 1, max: 5 },
    remark: { type: String, trim: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const studentPortfolioSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      unique: true,
    },
    academic: [academicEntrySchema],
    behavior: [behaviorEntrySchema],
    skills: [skillEntrySchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("StudentPortfolio", studentPortfolioSchema);

