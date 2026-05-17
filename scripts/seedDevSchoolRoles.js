/**
 * One-shot dev seed: verified school + school_admin + active teacher + student (User) login.
 *
 * From educa-be:
 *   SEED_PASSWORD="your-plain-password" node scripts/seedDevSchoolRoles.js
 *
 * Optional:
 *   SEED_UDISE — 6–14 digits (default: random 11-digit code starting with 91)
 *   SEED_SCHOOL_NAME
 *
 * Login: school admin & teacher use email in the "email" field; student uses username in the same field (no @).
 * Prints a credential block at the end. Set SEED_PASSWORD for a known password; otherwise a random one is generated.
 */
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const School = require("../models/School");
const Teacher = require("../models/Teacher");
const { createDefaultClasses } = require("../utils/createDefaultClasses");
const { normalizePhone } = require("../utils/phone");
const { normalizeUsername } = require("../utils/username");

function randomUdise() {
  const env = process.env.SEED_UDISE;
  if (env && /^[0-9]{6,14}$/.test(String(env).trim())) {
    return String(env).trim();
  }
  if (env) {
    console.warn("SEED_UDISE must be 6–14 digits; generating a random UDISE instead.");
  }
  return `91${String(Date.now()).slice(-9)}`;
}

function randomPassword() {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const password = process.env.SEED_PASSWORD || randomPassword();
  const udiseCode = randomUdise();
  const schoolName = process.env.SEED_SCHOOL_NAME || `Dev Seed School (${udiseCode})`;

  const schoolAdminEmail = `seed.sa.${udiseCode}@example.com`;
  const teacherEmail = `seed.teacher.${udiseCode}@example.com`;
  const studentUsername = normalizeUsername(`seedstudent${udiseCode}`);

  await mongoose.connect(uri);

  const dupUdise = await School.findOne({ udiseCode }).lean();
  if (dupUdise) {
    console.error("School with SEED_UDISE already exists:", udiseCode);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const teacherPhone = "9999999999";
  const pn = normalizePhone(teacherPhone);

  const schoolAdmin = await User.create({
    name: "Seed School Admin",
    email: schoolAdminEmail,
    password: hash,
    role: "school_admin",
    phone: teacherPhone,
    ...(pn ? { phoneNormalized: pn } : {}),
    isBlocked: false,
  });

  const school = await School.create({
    name: schoolName,
    udiseCode,
    affiliationBoard: "CBSE",
    affiliationNumber: `SEED-${udiseCode}`,
    addressLine1: "Seed Address",
    city: "Dev City",
    pincode: "110001",
    email: schoolAdminEmail,
    phone: teacherPhone,
    authorizedPerson: {
      fullName: schoolAdmin.name,
      designation: "Admin",
      officialEmail: schoolAdminEmail,
      mobile: teacherPhone,
    },
    verificationStatus: "Verified",
    // Omit verifiedAt so subscription trial logic treats billing as allowed (dev-friendly).
    createdBy: schoolAdmin._id,
  });

  schoolAdmin.schoolId = school._id;
  await schoolAdmin.save();

  await createDefaultClasses(school._id);

  const teacherUser = await User.create({
    name: "Seed Teacher",
    email: teacherEmail,
    password: hash,
    role: "teacher",
    schoolId: school._id,
    phone: teacherPhone,
    ...(pn ? { phoneNormalized: pn } : {}),
    isBlocked: false,
  });

  await Teacher.create({
    userId: teacherUser._id,
    schoolId: school._id,
    phone: teacherPhone,
    subjectIds: [],
    status: "active",
  });

  const studentUser = await User.create({
    name: "Seed Student",
    username: studentUsername,
    password: hash,
    role: "student",
    schoolId: school._id,
    isBlocked: false,
  });

  await mongoose.disconnect();

  console.log("\n========== SEED CREDENTIALS (copy & store securely) ==========\n");
  console.log("Shared password (all three accounts):", password);
  console.log("");
  console.log("School admin (login with email):");
  console.log("  Email:   ", schoolAdminEmail);
  console.log("  Role:    school_admin");
  console.log("  School: ", school.name, "| udise:", udiseCode);
  console.log("");
  console.log("Teacher (login with email):");
  console.log("  Email:   ", teacherEmail);
  console.log("  Role:    teacher");
  console.log("");
  console.log("Student user (login with username in the email/username field):");
  console.log("  Username:", studentUsername);
  console.log("  Role:    student");
  console.log("");
  console.log("===============================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
