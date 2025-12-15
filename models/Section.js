const mongoose = require("mongoose");

const sectionSchema = new mongoose.Schema(
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
    name: { type: String, required: true }, // A, B, C
    capacity: { type: Number, default: null },
  },
  { timestamps: true }
);

sectionSchema.index({ classId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Section", sectionSchema);
