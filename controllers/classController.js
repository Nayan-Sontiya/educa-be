const { default: mongoose } = require("mongoose");
const ClassSection = require("../models/ClassSection");
const Class = require("../models/Class");

exports.getClasses = async (req, res) => {
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

exports.addClass = async (req, res) => {
  try {
    const { name, sectionId } = req.body;

    const newClass = await Class.create({
      schoolId: req.user.schoolId,
      name,
      sectionId,
    });

    res.status(201).json({
      data: newClass,
      total: 1,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        data: [],
        total: 0,
        message: "Class already exists",
      });
    }

    res.status(500).json({ data: [], total: 0, error });
  }
};

exports.updateClassStatus = async (req, res) => {
  try {
    const { classId } = req.params;
    const { status } = req.body; // active/inactive

    const updated = await Class.findByIdAndUpdate(
      classId,
      { status },
      { new: true }
    );

    res.json({ data: updated, total: 1 });
  } catch (error) {
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.deleteClass = async (req, res) => {
  try {
    const { classId } = req.params;

    await ClassSection.findByIdAndDelete(classId);

    res.json({ data: [], total: 0 });
  } catch (error) {
    res.status(500).json({ data: [], total: 0 });
  }
};
