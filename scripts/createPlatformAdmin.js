/**
 * Create a platform super admin (role: admin) if one does not exist with this email.
 *
 * Usage (from educa-be root):
 *   node scripts/createPlatformAdmin.js
 *
 * Optional env (recommended for local dev only):
 *   PLATFORM_ADMIN_EMAIL
 *   PLATFORM_ADMIN_PASSWORD
 *   PLATFORM_ADMIN_NAME
 *
 * If the user already exists, the script exits without changing the password.
 * To reset password, use the web dashboard (User Management) or admin API.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set in environment.");
    process.exit(1);
  }

  const email = (
    process.env.PLATFORM_ADMIN_EMAIL || "admin@platform.local"
  ).toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD || "ChangeMe123!";
  const name = process.env.PLATFORM_ADMIN_NAME || "Platform Super Admin";

  await mongoose.connect(uri);

  const exists = await User.findOne({ email });
  if (exists) {
    console.log("A user with this email already exists:", email);
    console.log("No changes made. Sign in with that account or pick another email.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    password: hash,
    role: "admin",
    isBlocked: false,
  });

  console.log("Platform super admin created.");
  console.log("  Email:", email);
  console.log("  Password:", password);
  console.log(
    "Change PLATFORM_ADMIN_PASSWORD (and email) for production; do not commit secrets."
  );

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
