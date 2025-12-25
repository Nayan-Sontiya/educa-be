// models/Class.js
const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    order: {
      type: Number,
      required: true, // 🔑 sequence control
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

classSchema.index({ schoolId: 1, name: 1 }, { unique: true });
classSchema.index({ schoolId: 1, order: 1 });

module.exports = mongoose.model("Class", classSchema);
