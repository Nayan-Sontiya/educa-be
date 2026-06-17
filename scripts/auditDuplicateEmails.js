/**
 * Report users that share the same email (case-insensitive).
 * Does not modify data — run before deploy to see if cleanup is needed.
 *
 * Usage:
 *   node scripts/auditDuplicateEmails.js
 *   node scripts/auditDuplicateEmails.js --fix-casing
 *
 * --fix-casing  Lowercase emails on users where no conflict remains after normalize.
 */
require("dotenv").config();
const { connectScriptDb } = require("./scriptDb");
const User = require("../models/User");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function main() {
  const fixCasing = process.argv.includes("--fix-casing");

  const mongoose = await connectScriptDb();
  console.log("Connected to MongoDB\n");

  const users = await User.find({
    email: { $exists: true, $nin: [null, ""] },
  })
    .select("_id name email role schoolId createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const byEmail = new Map();
  for (const u of users) {
    const key = normalizeEmail(u.email);
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(u);
  }

  const duplicateGroups = [...byEmail.entries()].filter(([, list]) => list.length > 1);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate emails found (case-insensitive).");
  } else {
    console.log(`Found ${duplicateGroups.length} email(s) used by multiple accounts:\n`);
    for (const [email, list] of duplicateGroups) {
      console.log(`--- ${email} (${list.length} accounts) ---`);
      for (const u of list) {
        console.log(
          `  ${u._id}  role=${u.role}  stored="${u.email}"  schoolId=${u.schoolId || "-"}  created=${u.createdAt?.toISOString?.() || u.createdAt}`
        );
      }
      console.log("");
    }
    console.log(
      "Action required: merge or remove extra accounts manually before relying on unique email.\n" +
        "New signups are blocked by the API if any account already has that email (case-insensitive).\n"
    );
  }

  // Exact-string duplicates (would block MongoDB unique index creation)
  const pipeline = [
    { $match: { email: { $exists: true, $type: "string", $ne: "" } } },
    { $group: { _id: "$email", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ];
  const exactDupes = await User.aggregate(pipeline);
  if (exactDupes.length > 0) {
    console.log(`Exact same email string (${exactDupes.length} group(s)) — index may fail:`);
    for (const g of exactDupes) {
      console.log(`  "${g._id}" × ${g.count}  ids=${g.ids.join(", ")}`);
    }
    console.log("");
  }

  if (fixCasing && duplicateGroups.length === 0) {
    let updated = 0;
    for (const u of users) {
      const norm = normalizeEmail(u.email);
      if (norm && u.email !== norm) {
        await User.updateOne({ _id: u._id }, { $set: { email: norm } });
        updated += 1;
      }
    }
    console.log(`Normalized casing on ${updated} user(s).`);
  } else if (fixCasing && duplicateGroups.length > 0) {
    console.log("Skipped --fix-casing: resolve duplicate groups first.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
