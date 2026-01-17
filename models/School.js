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
    // Address fields
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    district: String,
    state: String,
    pincode: { type: String, required: true },
    // Contact / admin
    email: { type: String, required: true, unique: true },
    phone: String,
    authorizedPerson: {
      fullName: String,
      designation: String,
      officialEmail: String,
      mobile: String,
      mobileVerified: { type: Boolean, default: false },
    },
    // Uploaded documents paths
    documents: {
      registrationCertificate: String,
      affiliationCertificate: String,
      principalIdProof: String,
    },
    // verification
    verificationStatus: {
      type: String,
      enum: ["Pending", "Verified", "Rejected"],
      default: "Pending",
    },
    udiseVerified: { type: Boolean, default: false },
    // OTP for mobile verification (dev only)
    otp: {
      code: String,
      expiresAt: Date,
    },
    // Leave management
    paidLeaveCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // School listing information (for public discovery platform)
    listing: {
      // Gallery images (max 10)
      gallery: [
        {
          type: String, // File path
        },
      ],
      about: { type: String, trim: true },
      vision: { type: String, trim: true },
      mission: { type: String, trim: true },
      contactNumber: { type: String, trim: true },
      contactEmail: { type: String, trim: true },
      websiteUrl: { type: String, trim: true },
      admissionStatus: {
        type: String,
        enum: ["open", "closed"],
        default: "closed",
      },
      facilities: [String], // Array of facility names
      // Google Maps location
      mapLocation: {
        latitude: Number,
        longitude: Number,
        address: String,
      },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("School", schoolSchema);
