const Subject = require("../models/Subject");

exports.createDefaultSubjects = async (classId, schoolId) => {
  const DEFAULT_SUBJECTS = [
    "English",
    "Hindi",
    "Math",
    "Science",
    "Social Science",
  ];

  const bulk = DEFAULT_SUBJECTS.map((name) => ({
    classId,
    schoolId,
    name,
  }));

  await Subject.insertMany(bulk);
};
