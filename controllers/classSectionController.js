// controllers/classSectionController.js
const ClassSection = require("../models/ClassSection");

exports.assignSection = async (req, res) => {
  try {
    const { classId, sectionId } = req.body;

    if (!classId || !sectionId) {
      return res
        .status(400)
        .json({ message: "classId and sectionId required" });
    }

    const schoolId = req.user.schoolId;

    // Try to update existing placeholder (sectionId = null)
    const updated = await ClassSection.findOneAndUpdate(
      {
        schoolId,
        classId,
        sectionId: null, // 👈 placeholder row
      },
      {
        $set: { sectionId },
      },
      { new: true }
    );

    if (updated) {
      return res.status(200).json({ data: updated, total: 1 });
    }

    // Otherwise create a new one
    const created = await ClassSection.create({
      schoolId,
      classId,
      sectionId,
    });

    res.status(201).json({ data: created, total: 1 });
  } catch (error) {
    console.log("assignSection error:", error);
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
