const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");

exports.assignTeacher = async (req, res) => {
  try {
    const { teacherId, classSectionId, subjectId, role } = req.body;

    if (!teacherId || !classSectionId) {
      return res
        .status(400)
        .json({ message: "teacherId and classSectionId required" });
    }

    const assignment = await TeacherAssignment.create({
      schoolId: req.user.schoolId,
      teacherId,
      classSectionId,
      subjectId: subjectId || null,
      role: role || "subject_teacher",
    });

    res.status(201).json({ data: assignment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Teacher already assigned here" });
    }
    console.error("assignTeacher error:", error);
    res.status(500).json({ message: "Failed to assign teacher" });
  }
};

exports.unassignTeacher = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await TeacherAssignment.findOneAndDelete({
      _id: id,
      schoolId: req.user.schoolId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    res.json({ message: "Teacher unassigned" });
  } catch (error) {
    console.error("unassignTeacher error:", error);
    res.status(500).json({ message: "Failed to unassign teacher" });
  }
};

exports.getAssignments = async (req, res) => {
  const filter = { schoolId: req.user.schoolId };

  const data = await TeacherAssignment.find(filter)
    .populate({
      path: "teacherId",
      populate: [
        { path: "userId", select: "name email" },
        { path: "subjectIds", select: "name" },
      ],
    })
    .populate({
      path: "classSectionId",
      populate: [
        { path: "classId", select: "name order" },
        { path: "sectionId", select: "name" }, // 👈 THIS LINE
      ],
    });

  res.json({ data });
};

exports.getMyAssignments = async (req, res) => {
  try {
    console.log("Fetching assignments for user:", req.user.id);

    // 1. Find teacher by userId
    const teacher = await Teacher.findOne({
      userId: req.user.id,
      status: "active",
    });

    if (!teacher) {
      return res
        .status(403)
        .json({ message: "Teacher not active or not found" });
    }
    // 2. Fetch assignments using teacher._id
    const data = await TeacherAssignment.find({
      teacherId: teacher._id,
      status: "active",
    }).populate({
      path: "classSectionId",
      populate: [
        { path: "classId", select: "name order" },
        { path: "sectionId", select: "name" },
      ],
    });

    res.json({ data });
  } catch (err) {
    console.error("getMyAssignments error:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
};

exports.getAssignmentsByClassSection = async (req, res) => {
  try {
    const { classSectionId } = req.params;

    const data = await TeacherAssignment.find({
      classSectionId,
      status: "active",
    })
      .populate({
        path: "teacherId",
        populate: [
          { path: "userId", select: "name email" },
          { path: "subjectIds", select: "name" },
        ],
      })
      .populate({
        path: "classSectionId",
        populate: [
          { path: "classId", select: "name order" },
          { path: "sectionId", select: "name" },
        ],
      });

    res.json({ data });
  } catch (err) {
    console.error("getAssignmentsByClassSection error:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
};
