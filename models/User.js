// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Email is required for non-parent users (admin/teacher/school_admin),
    // optional for parents who will primarily log in via username.
    email: {
      type: String,
      required: function () {
        return this.role !== "parent";
      },
      unique: true,
      sparse: true,
    },
    // Username will be used especially for parent logins and must be unique if present.
    username: {
      type: String,
      unique: true,
      sparse: true,
    },
    password: { type: String, required: true },
    phone: { type: String },
    role: {
      type: String,
      enum: ["admin", "teacher", "counselor", "school_admin", "parent"],
      default: "teacher",
    },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
