/**
 * One-time: normalize platform news mediaUrl in MongoDB (full URLs -> relative/cloudinary).
 * Run: node scripts/fixPlatformNewsMediaUrls.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });

const connectDB = require("../config/db");
const PlatformNews = require("../models/PlatformNews");
const { normalizeStoredMediaPath } = require("../utils/platformNewsMedia");

async function main() {
  await connectDB();
  const items = await PlatformNews.find({});
  let updated = 0;

  for (const doc of items) {
    const before = doc.mediaUrl || "";
    const after = doc.mediaType === "none" ? "" : normalizeStoredMediaPath(before);
    if (before !== after) {
      doc.mediaUrl = after;
      await doc.save();
      updated += 1;
      console.log(`${doc._id}: ${before.slice(0, 80)} -> ${after.slice(0, 80)}`);
    }
  }

  console.log(`Done. Updated ${updated} of ${items.length} posts.`);
  console.log(
    "Posts with uploads/… paths need re-upload (Cloudinary) — those files are not on the server.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
