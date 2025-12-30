require("dotenv").config();
const mongoose = require("mongoose");
const Subject = require("../models/Subject");

// Common subjects in Indian schools
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

const SCHOOL_ID = "68fe5f52d7dc6dd0fa50d566"; // 👈 change to your school ID

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🟢 Mongo connected");

    // Delete existing subjects for this school (optional - comment out if you want to keep existing)
    const deleted = await Subject.deleteMany({ schoolId: SCHOOL_ID });
    console.log(`🗑 Deleted ${deleted.deletedCount} existing subjects`);

    // Create default subjects
    const docs = DEFAULT_SUBJECTS.map((name) => ({
      schoolId: SCHOOL_ID,
      name,
    }));

    const createdSubjects = await Subject.insertMany(docs);
    console.log(`✅ Created ${createdSubjects.length} default subjects:`);
    createdSubjects.forEach((subject) => {
      console.log(`   - ${subject.name}`);
    });
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

