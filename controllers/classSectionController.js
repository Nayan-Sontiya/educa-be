// controllers/classSectionController.js
const ClassSection = require("../models/ClassSection");

exports.assignSection = async (req, res) => {
  try {
    const { classId, name } = req.body;

    const created = await ClassSection.create({
      schoolId: req.user.schoolId,
      classId,
      name,
    });

    res.status(201).json({ data: created, total: 1 });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Section already assigned to this class",
        data: [],
        total: 0,
      });
    }
    res.status(500).json({ message: "Failed to assign section" });
  }
};

exports.deleteSection = async (req, res) => {
  try {
    await ClassSection.findByIdAndDelete(req.params.id);
    res.json({ data: [], total: 0 });
  } catch {
    res.status(500).json({ message: "Failed to delete section" });
  }
};
