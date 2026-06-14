// models/Student.js
const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    studentIdentityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentIdentity",
      index: true,
    },
    rollNumber: {
      type: String,
      trim: true,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    admissionDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending"],
      default: "active",
    },
    /** When school subscription is active: `included` counts toward paid seats; `pending_purchase` awaits admin proration checkout. */
    seatBillingStatus: {
      type: String,
      enum: ["included", "pending_purchase"],
      default: "included",
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    classSectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassSection",
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
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Held until pending student is activated via payment; cleared after DLT SMS send. */
    pendingCredentialsSms: {
      phone: { type: String, default: null },
      schoolName: { type: String, default: null },
      studentName: { type: String, default: null },
      classSectionLabel: { type: String, default: null },
      username: { type: String, default: null },
      password: { type: String, default: null },
      /** @deprecated legacy plain-text; cannot be sent via DLT */
      message: { type: String, default: null },
    },
  },
  { timestamps: true }
);

// Prevent duplicate roll numbers within the same class section
studentSchema.index(
  { classSectionId: 1, rollNumber: 1 },
  { unique: true, sparse: true }
);
studentSchema.index({ parentUserId: 1, status: 1 });

module.exports = mongoose.model("Student", studentSchema);

