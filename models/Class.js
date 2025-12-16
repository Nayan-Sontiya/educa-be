const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
      default: null,
    },
    name: { type: String, required: true }, // Nursery, KG1, Grade 1, etc.
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// ✅ When sectionId EXISTS → enforce uniqueness
classSchema.index(
  { schoolId: 1, name: 1, sectionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sectionId: { $exists: true, $ne: null },
    },
  }
);

// ✅ When sectionId DOES NOT EXIST → unique per school + name
classSchema.index(
  { schoolId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sectionId: null,
    },
  }
);
module.exports = mongoose.model("Class", classSchema);
