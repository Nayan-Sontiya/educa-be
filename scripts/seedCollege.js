// scripts/seedCollege.js
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const College = require("../models/College");
const { normalizeEmail } = require("../utils/emailUniqueness");

async function seedCollege() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/educa";
    console.log("Connecting to MongoDB:", mongoUri);
    await mongoose.connect(mongoUri);

    const email = normalizeEmail("aman.sontiya+college@utthanai.com");
    const plainPassword = "Test@123";
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(plainPassword, salt);

    console.log(`Seeding College user: ${email}...`);

    // 1. Find or create User
    let user = await User.findOne({ email });
    if (user) {
      console.log("Updating existing user record...");
      user.name = "Aman Sontiya";
      user.password = passwordHash;
      user.role = "college_admin";
      user.phone = "9876543210";
      user.city = "Indore";
      user.state = "Madhya Pradesh";
      user.isBlocked = false;
      user.isOnboarded = false;
    } else {
      console.log("Creating new user record...");
      user = new User({
        name: "Aman Sontiya",
        email,
        password: passwordHash,
        role: "college_admin",
        phone: "9876543210",
        city: "Indore",
        state: "Madhya Pradesh",
        isBlocked: false,
        isOnboarded: false,
      });
    }

    // 2. Find or create College
    let college = await College.findOne({ officialEmail: email });
    if (college) {
      console.log("Updating existing college record...");
      college.name = "Utthan Institute of Science & Technology";
      college.phone = "9876543210";
      college.city = "Indore";
      college.state = "Madhya Pradesh";
      college.representative = {
        name: "Aman Sontiya",
        designation: "Director",
      };
      college.verificationStatus = "Verified";
      college.createdBy = user._id;
    } else {
      console.log("Creating new college record...");
      college = new College({
        name: "Utthan Institute of Science & Technology",
        officialEmail: email,
        phone: "9876543210",
        city: "Indore",
        state: "Madhya Pradesh",
        representative: {
          name: "Aman Sontiya",
          designation: "Director",
        },
        verificationStatus: "Verified",
        createdBy: user._id,
      });
    }

    await college.save();

    user.collegeId = college._id;
    await user.save();

    console.log("----------------------------------------");
    console.log("✅ College Seeded Successfully!");
    console.log("College Name:", college.name);
    console.log("Email:", college.officialEmail);
    console.log("Password:", plainPassword);
    console.log("Role:", user.role);
    console.log("Verification Status:", college.verificationStatus);
    console.log("----------------------------------------");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding college:", error);
    process.exit(1);
  }
}

seedCollege();
