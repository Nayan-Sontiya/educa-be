// controllers/classSectionController.js
const { default: mongoose } = require("mongoose");
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

exports.getClassWithSections = async (req, res) => {
  try {
    const schoolId = new mongoose.Types.ObjectId(req.user.schoolId);

    const data = await ClassSection.aggregate([
      { $match: { schoolId } },

      // Join Class
      {
        $lookup: {
          from: "classes",
          localField: "classId",
          foreignField: "_id",
          as: "class",
        },
      },
      {
        $unwind: {
          path: "$class",
          preserveNullAndEmptyArrays: true, // ✅ keep orphan rows
        },
      },

      // Join Section
      {
        $lookup: {
          from: "sections",
          localField: "sectionId",
          foreignField: "_id",
          as: "section",
        },
      },
      {
        $unwind: {
          path: "$section",
          preserveNullAndEmptyArrays: true, // ✅ keep rows with no section
        },
      },

      // Shape response
      {
        $project: {
          _id: 1,
          sectionId: 1,
          sectionName: "$section.name",
          classId: "$class._id",
          className: "$class.name",
          classOrder: "$class.order",
          status: 1,
          isDefault: 1,
        },
      },

      // Sort with null-safe order
      {
        $sort: {
          classOrder: 1,
          sectionName: 1,
        },
      },
    ]);

    res.json({ data, total: data.length });
  } catch (error) {
    console.error("getClasses error:", error);
    res.status(500).json({ data: [], total: 0 });
  }
};
