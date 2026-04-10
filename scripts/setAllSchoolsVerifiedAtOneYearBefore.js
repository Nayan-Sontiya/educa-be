/**
 * Set School.verifiedAt for all schools to exactly one calendar year before a reference instant.
 *
 * Default reference (your "current"): 2026-04-07T17:52:55.902Z
 * → verifiedAt = 2025-04-07T17:52:55.902Z
 *
 * Override reference:
 *   node scripts/setAllSchoolsVerifiedAtOneYearBefore.js --dry-run --as-of 2026-04-07T17:52:55.902Z
 *
 * Usage (educa-be root, MONGO_URI in .env):
 *   node scripts/setAllSchoolsVerifiedAtOneYearBefore.js --dry-run
 *   node scripts/setAllSchoolsVerifiedAtOneYearBefore.js --i-am-sure
 */
require("dotenv").config();
const mongoose = require("mongoose");
const School = require("../models/School");

const DEFAULT_AS_OF_ISO = "2026-04-07T17:52:55.902Z";

function parseAsOfArg() {
  const i = process.argv.indexOf("--as-of");
  if (i === -1 || !process.argv[i + 1]) return DEFAULT_AS_OF_ISO;
  return String(process.argv[i + 1]).trim();
}

function verifiedAtOneYearBefore(asOfIso) {
  const ref = new Date(asOfIso);
  if (Number.isNaN(ref.getTime())) {
    throw new Error(`Invalid --as-of date: ${asOfIso}`);
  }
  const out = new Date(ref.getTime());
  out.setUTCFullYear(out.getUTCFullYear() - 1);
  return out;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--i-am-sure");

  if (!dryRun && !confirmed) {
    console.error("Refusing: pass --dry-run or --i-am-sure");
    process.exit(1);
  }

  const asOfIso = parseAsOfArg();
  const verifiedAt = verifiedAtOneYearBefore(asOfIso);

  await mongoose.connect(uri);

  const total = await School.countDocuments({});

  console.log("Reference (as-of):", asOfIso);
  console.log("verifiedAt to set: ", verifiedAt.toISOString());
  console.log("School documents:  ", total);

  if (dryRun) {
    console.log("Dry run — no writes.");
    await mongoose.disconnect();
    return;
  }

  const res = await School.updateMany({}, { $set: { verifiedAt: verifiedAt } });
  console.log("updateMany:", {
    matchedCount: res.matchedCount,
    modifiedCount: res.modifiedCount,
  });

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
