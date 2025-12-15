const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["academic", "skill", "optional"],
      default: "academic",
    },
  },
  { timestamps: true }
);

subjectSchema.index({ classId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
