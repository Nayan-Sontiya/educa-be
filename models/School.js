// models/School.js
const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    udiseCode: { type: String, required: true, unique: true },
    affiliationBoard: { type: String, required: true },
    affiliationNumber: { type: String, required: true },
    yearEstablished: { type: Number },
    schoolType: { type: String },
    schoolCategory: { type: String },
    description: { type: String },
    email: { type: String, required: true, unique: true },
    phone: String,
    address: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
