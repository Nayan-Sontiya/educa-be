const Subject = require("../models/Subject");

exports.addSubject = async (req, res) => {
  try {
    const { classId, name, type } = req.body;

    const subject = await Subject.create({
      schoolId: req.user.schoolId,
      classId,
      name,
      type,
    });

    res.status(201).json({ data: subject, total: 1 });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Subject already exists in this class",
        data: [],
        total: 0,
      });
    }
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const mapped = await TeacherClassSubject.countDocuments({ subjectId });
    if (mapped > 0) {
      return res.status(400).json({
        message: "Subject assigned to teachers/students",
        data: [],
        total: 0,
      });
    }

    await Subject.findByIdAndDelete(subjectId);

    res.json({ data: [], total: 0 });
  } catch (error) {
    res.status(500).json({ data: [], total: 0 });
  }
};

// 📌 Get all subjects for a class
exports.getSubjectsByClass = async (req, res) => {
  try {
    const { classId } = req.params;

    const subjects = await Subject.find({ classId }).sort({ name: 1 });

    const formatted = subjects.map((sub) => ({
      id: sub._id,
      name: sub.name,
      classId: sub.classId,
      type: sub.type,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    }));

    res.status(200).json({
      data: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error("Error fetching subjects:", error.message);
    res.status(500).json({
      data: [],
      total: 0,
    });
  }
};
