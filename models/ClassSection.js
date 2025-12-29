// models/ClassSection.js
const mongoose = require("mongoose");

const classSectionSchema = new mongoose.Schema(
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
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
    },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

classSectionSchema.index(
  { schoolId: 1, classId: 1, sectionId: 1 },
  { unique: true }
);

module.exports = mongoose.model("ClassSection", classSectionSchema);
