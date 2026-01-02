require("dotenv").config();
const mongoose = require("mongoose");
const Subject = require("../models/Subject");

const DEFAULT_SUBJECTS = [
  "English",
  "Hindi",
  "Mathematics",
  "Science",
  "Social Studies",
  "Computer Science",
  "Physical Education",
  "Art",
  "Music",
  "Environmental Studies (EVS)",
  "Sanskrit",
];

const SCHOOL_ID = "6957e6f76f45b3d4b27bdee6"; // 👈 change if needed

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🟢 Mongo connected");

    const collection = mongoose.connection.db.collection("subjects");

    // 🔥 Drop the old wrong index if it exists
    const indexes = await collection.indexes();
    const hasWrongIndex = indexes.find((i) => i.name === "classId_1_name_1");

    if (hasWrongIndex) {
      await collection.dropIndex("classId_1_name_1");
      console.log("🗑 Dropped old index: classId_1_name_1");
    } else {
      console.log("ℹ️ No old classId_1_name_1 index found");
    }

    // ✅ Ensure correct unique index exists
    await collection.createIndex({ schoolId: 1, name: 1 }, { unique: true });
    console.log("🔐 Ensured unique index: { schoolId: 1, name: 1 }");

    // 🗑 Delete existing subjects for this school
    const deleted = await Subject.deleteMany({ schoolId: SCHOOL_ID });
    console.log(`🗑 Deleted ${deleted.deletedCount} existing subjects`);

    // 📌 Insert defaults
    const docs = DEFAULT_SUBJECTS.map((name) => ({
      schoolId: SCHOOL_ID,
      name,
    }));

    const created = await Subject.insertMany(docs);
    console.log(`✅ Created ${created.length} subjects:`);

    created.forEach((s) => console.log(`   - ${s.name}`));
  } catch (err) {
    console.error("❌ Error:", err.message || err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
