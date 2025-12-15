const Class = require("../models/Class");

exports.getClasses = async (req, res) => {
  try {
    const classes = await Class.find({ schoolId: req.user.schoolId }).sort({
      name: 1,
    });
    console.log(classes);
    res.json({
      data: classes,
      total: classes.length,
    });
  } catch (error) {
    console.log("Error fetching classes:", error.message);
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.addClass = async (req, res) => {
  try {
    const { name } = req.body;

    const newClass = await Class.create({
      schoolId: req.user.schoolId,
      name,
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

    res.status(500).json({ data: [], total: 0 });
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

    const studentCount = await Student.countDocuments({ classId });
    if (studentCount > 0) {
      return res.status(400).json({
        message: "Students exist in this class. Deactivate instead.",
        data: [],
        total: 0,
      });
    }

    await Class.findByIdAndDelete(classId);

    res.json({ data: [], total: 0 });
  } catch (error) {
    res.status(500).json({ data: [], total: 0 });
  }
};
