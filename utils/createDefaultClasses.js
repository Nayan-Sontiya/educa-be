const Class = require("../models/Class");

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
    // Check if classes already exist for this school
    const count = await Class.countDocuments({ schoolId });
    if (count > 0) return; // Already created

    const bulk = DEFAULT_CLASSES.map((name) => ({
      schoolId,
      name,
      status: "active",
    }));

    const created = await Class.insertMany(bulk);
    created.forEach((cls) => {
      createDefaultSubjects(cls._id, cls.schoolId);
    });
  } catch (error) {
    console.error("Error creating default classes:", error);
  }
};
