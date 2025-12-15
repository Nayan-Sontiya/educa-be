const Section = require("../models/Section");

exports.addSection = async (req, res) => {
  try {
    const { classId, name, capacity } = req.body;

    const section = await Section.create({
      schoolId: req.user.schoolId,
      classId,
      name,
      capacity,
    });

    res.status(201).json({ data: section, total: 1 });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Section already exists",
        data: [],
        total: 0,
      });
    }
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.deleteSection = async (req, res) => {
  try {
    const { sectionId } = req.params;

    const studentCount = await Student.countDocuments({ sectionId });

    if (studentCount > 0) {
      return res.status(400).json({
        message: "Students present. Reassign/Delete them first.",
        data: [],
        total: 0,
      });
    }

    await Section.findByIdAndDelete(sectionId);

    res.json({ data: [], total: 0 });
  } catch (e) {
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.getSectionsByClass = async (req, res) => {
  try {
    const { classId } = req.params;

    const sections = await Section.find({ classId }).sort({ name: 1 });

    const formatted = sections.map((s) => ({
      id: s._id,
      name: s.name,
      classId: s.classId,
      capacity: s.capacity,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.status(200).json({
      data: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error("Error fetching sections:", error.message);
    res.status(500).json({
      data: [],
      total: 0,
    });
  }
};
