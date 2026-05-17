/**
 * Create a User with role admin (platform super admin; see models/User.js).
 *
 * From educa-be root:
 *   ADMIN_PASSWORD="your-password" node scripts/createAdminUser.js
 *
 * Optional env (or set the same keys in educa-be/.env — loaded automatically):
 *   ADMIN_EMAIL   (default: aman.sontiya@utthanai.com)
 *   ADMIN_NAME    (default: Aman Sontiya)
 *
 * Password: ADMIN_PASSWORD, or legacy SCHOOL_ADMIN_PASSWORD / PLATFORM_ADMIN_PASSWORD.
 *
 * If a user with that email already exists, the script exits without changes.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const password =
    process.env.ADMIN_PASSWORD ||
    process.env.SCHOOL_ADMIN_PASSWORD ||
    process.env.PLATFORM_ADMIN_PASSWORD;
  if (!password) {
    console.error(
      "Missing password. Add to educa-be/.env (recommended, gitignored):\n" +
        "  ADMIN_PASSWORD=your-plain-password\n" +
        "Or in PowerShell for one run:\n" +
        "  $env:ADMIN_PASSWORD='your-plain-password'; node scripts/createAdminUser.js\n" +
        "Also accepted: SCHOOL_ADMIN_PASSWORD, PLATFORM_ADMIN_PASSWORD."
    );
    process.exit(1);
  }

  const email = (
    process.env.ADMIN_EMAIL ||
    process.env.SCHOOL_ADMIN_EMAIL ||
    process.env.PLATFORM_ADMIN_EMAIL ||
    "aman.sontiya@utthanai.com"
  ).toLowerCase();
  const name =
    process.env.ADMIN_NAME ||
    process.env.SCHOOL_ADMIN_NAME ||
    process.env.PLATFORM_ADMIN_NAME ||
    "Aman Sontiya";

  await mongoose.connect(uri);

  const exists = await User.findOne({ email });
  if (exists) {
    console.log("User already exists for email:", email);
    console.log("No changes made.");
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

  console.log("admin user created.");
  console.log("  Email:", email);
  console.log("  Role: admin");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
