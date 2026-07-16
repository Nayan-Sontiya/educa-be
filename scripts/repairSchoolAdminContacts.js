/**
 * Database Repair Script: Sync School Admin Contacts
 * 
 * Synchronizes the email and phone details of School documents (and their Razorpay customer accounts)
 * with their corresponding `school_admin` User profiles.
 * 
 * Usage:
 *   node scripts/repairSchoolAdminContacts.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");
const User = require("../models/User");
const School = require("../models/School");
const SchoolSubscription = require("../models/SchoolSubscription");
const { ensureRazorpayCustomer } = require("../utils/razorpayService");
const { normalizeEmail } = require("../utils/emailUniqueness");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI environment variable is not set.");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("✅ Connected to database.");

  // Fetch all school administrators
  const admins = await User.find({ role: "school_admin", schoolId: { $exists: true } });
  console.log(`🔍 Found ${admins.length} school admin users to check.`);

  let updatedCount = 0;

  for (const admin of admins) {
    const school = await School.findById(admin.schoolId);
    if (!school) {
      console.log(`⚠️ User "${admin.name}" (${admin.email}) has schoolId ${admin.schoolId} but no School document exists.`);
      continue;
    }

    let schoolChanged = false;
    const oldEmail = school.email;
    const oldPhone = school.phone;

    // Check email
    if (admin.email && normalizeEmail(school.email) !== normalizeEmail(admin.email)) {
      console.log(`🔄 Syncing email for school "${school.name}": "${oldEmail}" ➡️ "${admin.email}"`);
      school.email = admin.email;
      if (school.authorizedPerson) {
        school.authorizedPerson.officialEmail = admin.email;
      }
      schoolChanged = true;
    }

    // Check phone
    if (admin.phone && school.phone !== admin.phone) {
      console.log(`🔄 Syncing phone for school "${school.name}": "${oldPhone}" ➡️ "${admin.phone}"`);
      school.phone = admin.phone;
      if (school.authorizedPerson) {
        school.authorizedPerson.mobile = admin.phone;
      }
      schoolChanged = true;
    }

    if (schoolChanged) {
      await school.save();
      console.log(`💾 Saved School "${school.name}" database changes.`);

      // Sync with Razorpay Customer profile if exists
      const subDoc = await SchoolSubscription.findOne({ schoolId: school._id });
      if (subDoc && subDoc.razorpayCustomerId) {
        try {
          console.log(`💳 Syncing Razorpay customer details for school: ${school._id}...`);
          await ensureRazorpayCustomer(subDoc, school);
          console.log(`✅ Razorpay customer profile updated successfully.`);
        } catch (rzpErr) {
          console.error(`❌ Failed to update Razorpay customer:`, rzpErr.message);
        }
      }
      updatedCount++;
    }
  }

  console.log(`\n🎉 Repair run complete. Total schools updated: ${updatedCount}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Repair script failed:", e);
  process.exit(1);
});
