const { default: mongoose } = require("mongoose");
const ClassSection = require("../models/ClassSection");
const Class = require("../models/Class");

exports.getClasses = async (req, res) => {
  try {
    const schoolId = new mongoose.Types.ObjectId(req.user.schoolId);

    const data = await Class.find({ schoolId }).sort({ order: 1 });

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
