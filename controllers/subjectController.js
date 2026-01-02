const Subject = require("../models/Subject");

exports.addSubject = async (req, res) => {
  try {
    const { name } = req.body;
    const { schoolId } = req.user;
    const subject = await Subject.create({
      schoolId,
      name,
    });

    res.status(201).json({ data: subject, total: 1 });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Subject already exists",
        data: [],
        total: 0,
        error,
      });
    }
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params; // subjectId
    const { name } = req.body;
    const { schoolId } = req.user;

    if (!name) {
      return res.status(400).json({
        message: "Name is required",
        data: [],
        total: 0,
      });
    }

    // Check duplicate in same school
    const existing = await Subject.findOne({
      schoolId,
      name,
      _id: { $ne: subjectId }, // exclude current id
    });

    if (existing) {
      return res.status(400).json({
        message: "Subject already exists",
        data: [],
        total: 0,
      });
    }

    const updated = await Subject.findOneAndUpdate(
      { _id: subjectId, schoolId },
      { name },
      { new: true } // return updated doc
    );

    if (!updated) {
      return res.status(404).json({
        message: "Subject not found",
        data: [],
        total: 0,
      });
    }

    res.json({
      data: updated,
      total: 1,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      data: [],
      total: 0,
    });
  }
};

exports.deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    // const studentCount = await Student.countDocuments({ subjectId });

    // if (studentCount > 0) {
    //   return res.status(400).json({
    //     message: "Students present. Reassign/Delete them first.",
    //     data: [],
    //     total: 0,
    //   });
    // }

    await Subject.findByIdAndDelete(subjectId);

    res.json({ data: [], total: 0 });
  } catch (e) {
    res.status(500).json({ data: [], total: 0 });
  }
};

exports.getSubjectsByClass = async (req, res) => {
  try {
    const { classId } = req.params;

    const subjects = await Subject.find({ classId }).sort({ name: 1 });

    const formatted = subjects.map((s) => ({
      id: s._id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
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

exports.getSubjects = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const subjects = await Subject.find({ schoolId }).sort({ name: 1 });

    res.status(200).json({
      data: subjects,
      total: subjects.length,
    });
  } catch (error) {
    console.error("Error fetching subjects:", error.message);
    res.status(500).json({
      data: [],
      total: 0,
    });
  }
};
