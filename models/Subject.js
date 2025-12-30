const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    name: { type: String, required: true },
  },
  { timestamps: true }
);

subjectSchema.index({ schoolId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
