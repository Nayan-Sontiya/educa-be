// controllers/studentController.js
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Student = require("../models/Student");
const ClassSection = require("../models/ClassSection");
const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");
const StudentPortfolio = require("../models/StudentPortfolio");
const { sendSms } = require("../utils/smsService");

// Teacher creates a student in a specific class section and a linked parent user
exports.addStudentToClass = async (req, res) => {
  try {
    const {
      classSectionId,
      studentName,
      rollNumber,
      parentName,
      parentPhone,
      parentUsername,
      parentPassword,
    } = req.body;

    if (
      !classSectionId ||
      !studentName ||
      !parentPhone ||
      !parentPassword ||
      !parentUsername
    ) {
      return res.status(400).json({
        message:
          "classSectionId, studentName, parentPhone, parentUsername and parentPassword are required",
      });
    }

    const classSection = await ClassSection.findById(classSectionId)
      .populate("classId", "name")
      .populate("sectionId", "name")
      .populate("schoolId", "name");

    if (!classSection) {
      return res.status(404).json({ message: "Class section not found" });
    }

    // Ensure user belongs to same school (for non-teacher roles)
    // Teachers already see only their assigned classes in the UI,
    // so we don't block them here even if token.schoolId is missing/mismatched.
    if (
      req.user.role !== "teacher" &&
      req.user.schoolId &&
      classSection.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You are not allowed to add students to this class" });
    }

    // Check if a parent user already exists by username or phone.
    // It is allowed (and common) for the same parent account
    // to be linked with multiple children.
    // Note: We check username and phone, but NOT email (since parents use username)
    let parentUser = await User.findOne({
      $or: [{ username: parentUsername }, { phone: parentPhone }],
    });
    
    // Also check if username is already taken by another user (not just parent)
    if (!parentUser && parentUsername) {
      const usernameExists = await User.findOne({ username: parentUsername });
      if (usernameExists) {
        return res.status(409).json({
          message: `Username "${parentUsername}" is already taken. Please choose a different username.`,
        });
      }
    }

    let plainPasswordToSend = null;

    if (!parentUser) {
      const hash = await bcrypt.hash(parentPassword, 10);

      parentUser = await User.create({
        name: parentName || `${studentName}'s Parent`,
        username: parentUsername,
        phone: parentPhone,
        password: hash,
        role: "parent",
        schoolId: classSection.schoolId,
      });

      plainPasswordToSend = parentPassword;
    } else {
      // Parent already exists (same username or phone).
      // Keep their password, but we can refresh their basic details
      // from the payload so future logins use the latest info.
      if (parentName && parentName !== parentUser.name) {
        parentUser.name = parentName;
      }
      if (parentUsername && parentUsername !== parentUser.username) {
        parentUser.username = parentUsername;
      }
      await parentUser.save();
    }

    const student = await Student.create({
      name: studentName,
      rollNumber,
      schoolId: classSection.schoolId,
      classSectionId: classSection._id,
      classId: classSection.classId,
      sectionId: classSection.sectionId || null,
      parentUserId: parentUser._id,
    });

    // // Fire-and-forget SMS with credentials (if we created a new parent)
    // if (plainPasswordToSend) {
    //   const schoolName = classSection.schoolId?.name || "Your School";
    //   const className = classSection.classId?.name || "";
    //   const sectionName = classSection.sectionId?.name
    //     ? ` - Section ${classSection.sectionId.name}`
    //     : "";

    //   const message =
    //     `Educa Parent Login\n` +
    //     `School: ${schoolName}\n` +
    //     `Student: ${studentName}${className ? ` (${className}${sectionName})` : ""}\n` +
    //     `Username: ${parentUsername}\n` +
    //     `Password: ${plainPasswordToSend}\n` +
    //     `Use the Educa Parent app to log in and view updates about your child.`;

    //   sendSms(parentPhone, message).catch((err) =>
    //     console.error("Failed to send SMS:", err)
    //   );
    // }

    res.status(201).json({
      message: "Student and parent account created successfully",
      student,
      parent: {
        id: parentUser._id,
        name: parentUser.name,
        email: parentUser.email,
        phone: parentUser.phone,
      },
    });
  } catch (error) {
    console.error("addStudentToClass error:", error);
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const keyPattern = error.keyPattern || {};
      const keyValue = error.keyValue || {};
      
      // Handle roll number duplicate
      if (keyPattern.rollNumber && keyPattern.classSectionId) {
        const rollNum = req.body.rollNumber || keyValue.rollNumber || 'provided';
        return res.status(409).json({
          message: `Roll number "${rollNum}" already exists in this class section. Please use a different roll number.`,
        });
      }
      
      // Handle email duplicate (for null email case - should not happen with proper sparse index)
      if (keyPattern.email && (keyValue.email === null || keyValue.email === undefined)) {
        return res.status(409).json({
          message: "A user account already exists with this username or phone number. Please use a different username or phone.",
        });
      }
      
      // Handle username duplicate
      if (keyPattern.username && keyValue.username) {
        return res.status(409).json({
          message: `Username "${keyValue.username}" is already taken. Please choose a different username.`,
        });
      }
      
      // Handle email duplicate (for non-null emails)
      if (keyPattern.email && keyValue.email) {
        return res.status(409).json({
          message: `Email "${keyValue.email}" is already registered. Please use a different email.`,
        });
      }
      
      // Handle other duplicate key errors
      if (keyValue && Object.keys(keyValue).length > 0) {
        const duplicateField = Object.keys(keyValue)[0];
        const fieldValue = keyValue[duplicateField];
        return res.status(409).json({
          message: `A record with this ${duplicateField}${fieldValue ? ` (${fieldValue})` : ''} already exists.`,
        });
      }
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Validation error",
        errors: errors,
      });
    }
    
    // Generic error response
    res.status(500).json({
      message: "Error adding student to class",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get all students for a given class section (for teacher view)
exports.getStudentsForClassSection = async (req, res) => {
  try {
    const { classSectionId } = req.query;

    if (!classSectionId) {
      return res
        .status(400)
        .json({ message: "classSectionId query parameter is required" });
    }

    const students = await Student.find({ classSectionId })
      .populate("parentUserId", "name")
      .select("name rollNumber classSectionId parentUserId")
      .sort({ createdAt: 1 });

    const formatted = students.map((s) => ({
      _id: s._id,
      name: s.name,
      rollNumber: s.rollNumber,
      parentName: s.parentUserId?.name || "",
    }));

    res.json({ data: formatted });
  } catch (error) {
    console.error("getStudentsForClassSection error:", error);
    res.status(500).json({ message: "Error fetching students for class" });
  }
};

// Get all children for the logged-in parent
exports.getMyChildren = async (req, res) => {
  try {
    const parentUserId = req.user.id;

    const students = await Student.find({ parentUserId })
      .populate("classSectionId")
      .populate("classId", "name")
      .populate("sectionId", "name")
      .populate("schoolId", "name");

    const data = students.map((s) => ({
      _id: s._id,
      name: s.name,
      rollNumber: s.rollNumber,
      className: s.classId?.name || "",
      sectionName: s.sectionId?.name || "",
      schoolName: s.schoolId?.name || "",
      classSectionId: s.classSectionId?._id,
    }));

    res.json({ data });
  } catch (error) {
    console.error("getMyChildren error:", error);
    res.status(500).json({ message: "Error fetching children" });
  }
};

// Helpers
const ensureTeacherOrAdminCanAccessStudent = async (req, studentId) => {
  const student = await Student.findById(studentId);
  if (!student) {
    return { error: { status: 404, message: "Student not found" } };
  }

  // All roles must match school
  if (
    req.user.schoolId &&
    student.schoolId.toString() !== req.user.schoolId.toString()
  ) {
    return {
      error: {
        status: 403,
        message: "You are not allowed to access this student",
      },
    };
  }

  // For teachers, enforce assignment
  if (req.user.role === "teacher") {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) {
      return {
        error: { status: 403, message: "Teacher profile not found for this user" },
      };
    }

    const assignment = await TeacherAssignment.findOne({
      schoolId: student.schoolId,
      teacherId: teacher._id,
      classSectionId: student.classSectionId,
      status: "active",
    });

    if (!assignment) {
      return {
        error: {
          status: 403,
          message: "You are not assigned to this student's class",
        },
      };
    }
  }

  // For parents, ensure this is their child
  if (req.user.role === "parent") {
    if (student.parentUserId.toString() !== req.user.id) {
      return {
        error: {
          status: 403,
          message: "You are not allowed to view this student's records",
        },
      };
    }
  }

  return { student };
};

// Get a student's full portfolio (academic, behavior, skills)
exports.getStudentPortfolio = async (req, res) => {
  try {
    const { id } = req.params;

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(
      req,
      id
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    let portfolio = await StudentPortfolio.findOne({ studentId: student._id });
    if (!portfolio) {
      portfolio = await StudentPortfolio.create({ studentId: student._id });
    }

    res.json({ data: portfolio });
  } catch (error) {
    console.error("getStudentPortfolio error:", error);
    res.status(500).json({ message: "Error fetching student portfolio" });
  }
};

// Add an academic record to a student's portfolio
exports.addAcademicRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { term, subject, testName, marksObtained, maxMarks, grade, remarks, date } =
      req.body;

    if (!subject) {
      return res.status(400).json({ message: "Subject is required" });
    }

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(
      req,
      id
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    let portfolio = await StudentPortfolio.findOne({ studentId: student._id });
    if (!portfolio) {
      portfolio = await StudentPortfolio.create({ studentId: student._id });
    }

    portfolio.academic.push({
      term,
      subject,
      testName,
      marksObtained,
      maxMarks,
      grade,
      remarks,
      date,
    });

    await portfolio.save();

    res.json({
      message: "Academic record added successfully",
      data: portfolio,
    });
  } catch (error) {
    console.error("addAcademicRecord error:", error);
    res.status(500).json({ message: "Error adding academic record" });
  }
};

// Add a behavior record to a student's portfolio
exports.addBehaviorRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      discipline,
      attendanceBehavior,
      participation,
      socialInteraction,
      teacherComment,
    } = req.body;

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(
      req,
      id
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    let portfolio = await StudentPortfolio.findOne({ studentId: student._id });
    if (!portfolio) {
      portfolio = await StudentPortfolio.create({ studentId: student._id });
    }

    portfolio.behavior.push({
      date,
      discipline,
      attendanceBehavior,
      participation,
      socialInteraction,
      teacherComment,
    });

    await portfolio.save();

    res.json({
      message: "Behavior record added successfully",
      data: portfolio,
    });
  } catch (error) {
    console.error("addBehaviorRecord error:", error);
    res.status(500).json({ message: "Error adding behavior record" });
  }
};

// Add a skill record to a student's portfolio
exports.addSkillRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { area, rating, remark, date } = req.body;

    if (!area) {
      return res.status(400).json({ message: "Skill area is required" });
    }

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(
      req,
      id
    );
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    let portfolio = await StudentPortfolio.findOne({ studentId: student._id });
    if (!portfolio) {
      portfolio = await StudentPortfolio.create({ studentId: student._id });
    }

    portfolio.skills.push({
      area,
      rating,
      remark,
      date,
    });

    await portfolio.save();

    res.json({
      message: "Skill record added successfully",
      data: portfolio,
    });
  } catch (error) {
    console.error("addSkillRecord error:", error);
    res.status(500).json({ message: "Error adding skill record" });
  }
};

// Update a student's basic info (name, rollNumber)
exports.updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rollNumber } = req.body;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Ensure teacher belongs to same school as the student
    if (
      req.user.schoolId &&
      student.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You are not allowed to edit this student" });
    }

    if (name !== undefined) student.name = name;
    if (rollNumber !== undefined) student.rollNumber = rollNumber;

    await student.save();

    res.json({
      message: "Student updated successfully",
      student,
    });
  } catch (error) {
    console.error("updateStudent error:", error);
    res.status(500).json({ message: "Error updating student" });
  }
};

// Delete a student
exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Ensure teacher belongs to same school as the student
    if (
      req.user.schoolId &&
      student.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You are not allowed to delete this student" });
    }

    await Student.findByIdAndDelete(id);

    res.json({ message: "Student deleted successfully" });
  } catch (error) {
    console.error("deleteStudent error:", error);
    res.status(500).json({ message: "Error deleting student" });
  }
};


