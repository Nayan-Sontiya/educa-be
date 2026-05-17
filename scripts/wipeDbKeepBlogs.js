/**
 * Deletes all documents in every collection except marketing blog posts (BlogPost -> blogposts).
 * Run: WIPE_DB_KEEP_BLOGS_CONFIRM=yes node scripts/wipeDbKeepBlogs.js
 * Requires MONGO_URI in .env
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const mongoose = require("mongoose");

const KEEP_COLLECTION = "blogposts";

async function main() {
  if (process.env.WIPE_DB_KEEP_BLOGS_CONFIRM !== "yes") {
    console.error(
      "Refusing to run: set WIPE_DB_KEEP_BLOGS_CONFIRM=yes to wipe all collections except blogposts."
    );
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  const names = cols.map((c) => c.name).filter((n) => !n.startsWith("system."));

  for (const name of names.sort()) {
    if (name === KEEP_COLLECTION) {
      const n = await db.collection(name).countDocuments();
      console.log(`Keep ${name} (${n} documents)`);
      continue;
    }
    const res = await db.collection(name).deleteMany({});
    console.log(`Cleared ${name}: deleted ${res.deletedCount}`);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
