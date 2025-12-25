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

exports.createDefaultClasses = async (schoolId) => {
  try {
    // ✅ Prevent duplicate execution
    const existingCount = await Class.countDocuments({ schoolId });
    if (existingCount > 0) return;

    const bulkClasses = DEFAULT_CLASSES.map((name, index) => ({
      schoolId,
      name,
      order: index + 1, // 🔑 FIXED SEQUENCE
      status: "active",
    }));

    const createdClasses = await Class.insertMany(bulkClasses);
    for (const cls of createdClasses) {
      await ClassSection.create({
        schoolId,
        classId: cls._id,
        name: "Default",
        isDefault: true,
      });
    }
  } catch (error) {
    console.error("❌ Error creating default classes:", error);
    throw error;
  }
};
