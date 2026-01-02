const mongoose = require("mongoose");

const teacherAssignmentSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true,
    },
    classSectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassSection",
      required: true,
    },
    role: {
      type: String,
      enum: ["class_teacher", "subject_teacher"],
      default: "subject_teacher",
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

teacherAssignmentSchema.index(
  { schoolId: 1, teacherId: 1, classSectionId: 1, subjectId: 1 },
  { unique: true }
);

module.exports = mongoose.model("TeacherAssignment", teacherAssignmentSchema);
