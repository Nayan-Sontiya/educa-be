const Subject = require("../models/Subject");
const ClassSubject = require("../models/ClassSubject");
const ClassSection = require("../models/ClassSection");

exports.addSubject = async (req, res) => {
  try {
    const { name } = req.body;
    const { schoolId } = req.user;
    const subject = await Subject.create({
      schoolId,
      name,
    });

    res.status(201).json({ success: true, data: subject, total: 1 });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
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
        success: false,
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
        success: false,
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
        success: false,
        message: "Subject not found",
        data: [],
        total: 0,
      });
    }

    res.json({
      success: true,
      data: updated,
      total: 1,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
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

    res.json({ success: true, data: [], total: 0, message: "Subject deleted successfully" });
  } catch (e) {
    res.status(500).json({ success: false, data: [], total: 0, message: e.message });
  }
};

exports.getSubjectsByClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { schoolId } = req.user;

    // Find all ClassSections for this class
    const classSections = await ClassSection.find({
      classId,
      schoolId,
    }).select("_id");

    const classSectionIds = classSections.map((cs) => cs._id);

    // Find all subjects assigned to these class sections
    const classSubjects = await ClassSubject.find({
      classSectionId: { $in: classSectionIds },
      status: "active",
    }).populate("subjectId", "name _id");

    // Extract unique subjects
    const subjectMap = new Map();
    classSubjects.forEach((cs) => {
      if (cs.subjectId && !subjectMap.has(cs.subjectId._id.toString())) {
        subjectMap.set(cs.subjectId._id.toString(), {
          _id: cs.subjectId._id,
          name: cs.subjectId.name,
        });
      }
    });

    const formatted = Array.from(subjectMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    res.status(200).json({
      success: true,
      data: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error("Error fetching subjects by class:", error.message);
    res.status(500).json({
      success: false,
      data: [],
      total: 0,
      message: error.message,
    });
  }
};

exports.getSubjects = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const subjects = await Subject.find({ schoolId }).sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: subjects,
      total: subjects.length,
    });
  } catch (error) {
    console.error("Error fetching subjects:", error.message);
    res.status(500).json({
      success: false,
      data: [],
      total: 0,
      message: error.message,
    });
  }
};

exports.assignSubjectsToClass = async (req, res) => {
  try {
    const { classId, subjectIds } = req.body;
    const { schoolId } = req.user;

    if (!classId || !Array.isArray(subjectIds) || subjectIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "classId and subjectIds array are required",
      });
    }

    // Find all ClassSections for this class
    const classSections = await ClassSection.find({
      classId,
      schoolId,
    });

    if (classSections.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No class sections found for this class",
      });
    }

    // For each class section, assign the subjects
    const assignments = [];
    for (const classSection of classSections) {
      for (const subjectId of subjectIds) {
        try {
          // Check if assignment already exists
          const existing = await ClassSubject.findOne({
            classSectionId: classSection._id,
            subjectId,
          });

          if (!existing) {
            const assignment = await ClassSubject.create({
              schoolId,
              classSectionId: classSection._id,
              subjectId,
              status: "active",
            });
            assignments.push(assignment);
          }
        } catch (error) {
          // Skip if duplicate (unique constraint)
          if (error.code !== 11000) {
            console.error("Error assigning subject:", error);
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      data: assignments,
      message: "Subjects assigned to class successfully",
    });
  } catch (error) {
    console.error("Error assigning subjects to class:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to assign subjects to class",
    });
  }
};
