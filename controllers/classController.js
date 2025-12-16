const { default: mongoose } = require("mongoose");
const Class = require("../models/Class");

exports.getClasses = async (req, res) => {
  try {
    const classes = await Class.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(req.user.schoolId),
        },
      },
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
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          name: 1,
          status: 1,
          section: {
            _id: 1,
            name: 1,
          },
        },
      },
      {
        $sort: { updatedAt: 1 },
      },
    ]);

    res.json({
      data: classes,
      total: classes.length,
    });
  } catch (error) {
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

    // const studentCount = await Student.countDocuments({ classId });
    // if (studentCount > 0) {
    //   return res.status(400).json({
    //     message: "Students exist in this class. Deactivate instead.",
    //     data: [],
    //     total: 0,
    //   });
    // }

    await Class.findByIdAndDelete(classId);

    res.json({ data: [], total: 0 });
  } catch (error) {
    res.status(500).json({ data: [], total: 0 });
  }
};
