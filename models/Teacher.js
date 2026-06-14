// models/Teacher.js
const mongoose = require("mongoose");

const teacherSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    // NEW: Teacher's phone number
    phone: {
      type: String,
      trim: true,
    },
    subjectIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
    }],
    status: {
      type: String,
      enum: ["active", "pending", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

teacherSchema.index({ userId: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model("Teacher", teacherSchema);
