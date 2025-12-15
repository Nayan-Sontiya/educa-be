const express = require("express");
const router = express.Router();
const School = require("../models/School");
const ClassModel = require("../models/Class");

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

// ❗ ONLY FOR INTERNAL USE — remove after running
router.post("/init-default-classes", async (req, res) => {
  try {
    const schools = await School.find({});

    for (let school of schools) {
      const existing = await ClassModel.countDocuments({
        schoolId: school._id,
      });
      if (existing === 0) {
        const data = DEFAULT_CLASSES.map((name) => ({
          schoolId: school._id,
          name,
          status: "active",
        }));
        await ClassModel.insertMany(data);
      }
    }

    res.json({ message: "Default classes assigned to all schools" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
