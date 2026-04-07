// models/User.js
const mongoose = require("mongoose");
const { normalizePhone } = require("../utils/phone");
const { normalizeUsername } = require("../utils/username");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Email: unique when present, required for non-parent/student roles
    // For parents/students, email is optional (they use username instead)
    email: {
      type: String,
      required: function () {
        return this.role !== "parent" && this.role !== "student";
      },
      unique: true,
      sparse: true, // Allows multiple null/undefined values
      default: undefined, // Don't set to null, leave undefined if not provided
      validate: {
        validator: function (value) {
          // If email is provided, it must be a valid email format
          if (value && value.trim() !== "") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(value);
          }
          return true; // Allow empty/undefined for parent/student
        },
        message: "Please provide a valid email address",
      },
    },
    // Username: globally unique when present (sparse index — not scoped by school)
    username: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null/undefined values
      required: function () {
        return this.role === "parent" || this.role === "student";
      },
      validate: {
        validator: function (value) {
          // Username should be alphanumeric with optional underscore/hyphen
          if (value && value.trim() !== "") {
            const usernameRegex = /^[a-zA-Z0-9_-]+$/;
            return usernameRegex.test(value) && value.length >= 3;
          }
          return true;
        },
        message: "Username must be at least 3 characters and contain only letters, numbers, underscores, or hyphens",
      },
    },
    password: { type: String, required: true },
    phone: { type: String },
    phoneNormalized: { type: String, sparse: true, index: true },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
    },
    dateOfBirth: { type: Date },
    address: { type: String },
    pendingContactChange: {
      email: {
        value: String,
        code: String,
        expiresAt: Date,
        verified: { type: Boolean, default: false },
      },
      phone: {
        value: String,
        normalized: String,
        code: String,
        expiresAt: Date,
        verified: { type: Boolean, default: false },
      },
    },
    authOtp: {
      code: String,
      expiresAt: Date,
      attempts: { type: Number, default: 3 },
      resendCount: { type: Number, default: 0 },
      purpose: { type: String, enum: ["forgot", "change"] },
    },
    /** After OTP, applied bcrypt hash for change-password flow */
    pendingPasswordChange: {
      newPasswordHash: String,
      expiresAt: Date,
    },
    role: {
      type: String,
      enum: ["admin", "teacher", "counselor", "school_admin", "parent", "student"],
      default: "teacher",
    },
    /** Platform super admin can block sign-in and API access */
    isBlocked: { type: Boolean, default: false },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School" },
  },
  { timestamps: true }
);

// Custom validation: Ensure at least email OR username is provided
// (This is already enforced by required() functions, but adding explicit check)
userSchema.pre('validate', function (next) {
  // For non-parent/student roles, email is required (enforced by schema)
  // For parent/student roles, username is required (enforced by schema)
  // So this validation is mainly for clarity
  if (this.role === 'parent' || this.role === 'student') {
    if (!this.username || this.username.trim() === '') {
      return next(new Error('Username is required for parent and student users'));
    }
  }
  next();
});

// Ensure email is undefined (not null) for parent/student users to work with sparse index
userSchema.pre('save', function (next) {
  // Convert null to undefined for email (sparse index works better with undefined)
  if (this.email === null || this.email === '') {
    this.email = undefined;
  }
  // Username: empty → undefined; otherwise canonical form (trim + lowercase) for global uniqueness
  if (this.username === null || this.username === "") {
    this.username = undefined;
  } else {
    const n = normalizeUsername(this.username);
    this.username = n || undefined;
  }
  if (this.isModified("phone")) {
    const n = normalizePhone(this.phone);
    this.phoneNormalized = n || undefined;
  }
  next();
});

// Create sparse unique indexes
// These indexes ensure:
// - Email is unique when present (allows multiple null/undefined)
// - Username is unique when present (allows multiple null/undefined)
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true });

// Optional: Create a compound index to ensure email OR username uniqueness
// This helps with queries but the individual sparse indexes handle uniqueness

module.exports = mongoose.model("User", userSchema);
