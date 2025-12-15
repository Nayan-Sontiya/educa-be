const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
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

classSchema.index({ schoolId: 1, name: 1 }, { unique: true }); // prevent duplicate class per school

module.exports = mongoose.model("Class", classSchema);
