require("dotenv").config();
const mongoose = require("mongoose");
const Class = require("../models/Class");
const ClassSection = require("../models/ClassSection");

const DEFAULT_CLASSES = [
  "Nursery",
  "KG-1",
  "KG-2",
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

const SCHOOL_ID = "68fe5f52d7dc6dd0fa50d566"; // 👈 change

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🟢 Mongo connected");

    const deleted = await Class.deleteMany({ schoolId: SCHOOL_ID });
    console.log(`🗑 Deleted ${deleted.deletedCount} existing classes`);

    const docs = DEFAULT_CLASSES.map((name, index) => ({
      schoolId: SCHOOL_ID,
      name,
      order: index + 1,
      status: "active",
    }));

    const createdClasses = await Class.insertMany(docs);
    for (const cls of createdClasses) {
      await ClassSection.create({
        schoolId: SCHOOL_ID,
        classId: cls._id,
        name: "Default",
        isDefault: true,
      });
    }

    console.log("✅ Default classes recreated");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
