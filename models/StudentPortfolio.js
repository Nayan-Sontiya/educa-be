const mongoose = require("mongoose");

// ─── Evidence File ────────────────────────────────────────────────────────────
const evidenceFileSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String },
    originalName: { type: String },
    resourceType: { type: String, default: "image" },
  },
  { _id: false }
);

// ─── Academic Entry ───────────────────────────────────────────────────────────
const academicEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", index: true },
    weekNumber: { type: Number }, // ISO week number, auto-assigned
    term: { type: String, trim: true },
    assessmentType: {
      type: String,
      enum: ["test", "unit_test", "assignment", "homework", "project", "classwork", "oral_test"],
    },
    subject: { type: String, required: true, trim: true },
    testName: { type: String, trim: true },
    marksObtained: { type: Number },
    maxMarks: { type: Number },
    grade: { type: String, trim: true },
    remarks: { type: String, trim: true },
    evidenceFiles: [evidenceFileSchema],
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Behavior Entry ───────────────────────────────────────────────────────────
const BEHAVIOR_RATING = ["good", "average", "needs_attention"];

const behaviorEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", index: true },
    weekNumber: { type: Number },
    date: { type: Date, default: Date.now },
    /** When the teacher saved this entry (display); `date` is week anchor for the record */
    recordedAt: { type: Date },
    // discipline is a legacy free-text field — no enum to stay backward compatible
    discipline: { type: String, trim: true },
    // New structured rating fields (lowercase enum)
    respect: { type: String, enum: [...BEHAVIOR_RATING, null, ""] },
    attention: { type: String, enum: [...BEHAVIOR_RATING, null, ""] },
    interaction: { type: String, enum: [...BEHAVIOR_RATING, null, ""] },
    // Legacy fields kept for backward compatibility
    attendanceBehavior: { type: String, trim: true },
    participation: { type: String, trim: true },
    socialInteraction: { type: String, trim: true },
    teacherComment: { type: String, trim: true },
    teacherRemark: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Skill Entry ──────────────────────────────────────────────────────────────
const skillEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", index: true },
    weekNumber: { type: Number },
    // area enum expanded; no strict enum to stay backward compatible with old values
    area: { type: String, required: true, trim: true },
    ratingLabel: { type: String, trim: true }, // "good" | "average" | "needs_attention"
    rating: { type: Number, min: 1, max: 5 }, // legacy numeric rating
    remark: { type: String, trim: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Wellbeing Entry ──────────────────────────────────────────────────────────
const WELLBEING_TAGS = [
  "quiet", "isolated", "sad", "angry", "not_participating", "low_energy", "disturbed",
];

const wellbeingEntrySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", index: true },
    weekNumber: { type: Number },
    date: { type: Date, default: Date.now },
    recordedAt: { type: Date },
    status: {
      type: String,
      enum: ["happy_engaged", "neutral", "low_withdrawn"],
      required: true,
    },
    tags: [{ type: String, enum: WELLBEING_TAGS }],
    teacherRemark: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Portfolio Document ───────────────────────────────────────────────────────
const studentPortfolioSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      index: true,
      sparse: true,
    },
    studentIdentityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentIdentity",
      index: true,
      sparse: true,
    },
    academic: [academicEntrySchema],
    behavior: [behaviorEntrySchema],
    skills: [skillEntrySchema],
    wellbeing: [wellbeingEntrySchema],
  },
  { timestamps: true }
);

studentPortfolioSchema.index({ studentId: 1 }, { unique: true, sparse: true });
studentPortfolioSchema.index({ studentIdentityId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("StudentPortfolio", studentPortfolioSchema);
