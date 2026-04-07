// controllers/studentController.js
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Student = require("../models/Student");
const StudentIdentity = require("../models/StudentIdentity");
const ClassSection = require("../models/ClassSection");
const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");
const StudentPortfolio = require("../models/StudentPortfolio");
const School = require("../models/School");
const { sendSms } = require("../utils/smsService");
const { uploadBuffer } = require("../utils/cloudinary");
const { analyzePortfolio, getWeekNumber } = require("../utils/aiAnalysis");
const { normalizeUsername, suggestAvailableUsernames } = require("../utils/username");
const {
  resolvePortfolioForStudent,
  portfolioEntryCount,
} = require("../utils/studentPortfolioResolve");

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ensureStudentIdentityForStudent = async (student) => {
  if (student.studentIdentityId) return student.studentIdentityId;

  const identity = await StudentIdentity.create({
    parentUserId: student.parentUserId,
    name: student.name,
  });

  student.studentIdentityId = identity._id;
  await student.save();

  const portfolio = await StudentPortfolio.findOne({ studentId: student._id });
  if (portfolio && !portfolio.studentIdentityId) {
    portfolio.studentIdentityId = identity._id;
    await portfolio.save();
  }

  return identity._id;
};

const applyDefaultSchoolIdToEntries = (portfolio, defaultSchoolId) => {
  if (!portfolio || !defaultSchoolId) return false;

  let changed = false;
  const setDefault = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((entry) => {
      if (!entry.schoolId) {
        entry.schoolId = defaultSchoolId;
        changed = true;
      }
    });
  };

  setDefault(portfolio.academic);
  setDefault(portfolio.behavior);
  setDefault(portfolio.skills);

  return changed;
};

const loadSchoolsById = async (schoolIds) => {
  const ids = [...new Set((schoolIds || []).filter(Boolean).map(String))];
  if (!ids.length) return {};
  const schools = await School.find({ _id: { $in: ids } }).select("name");
  return schools.reduce((acc, s) => {
    acc[s._id.toString()] = { name: s.name };
    return acc;
  }, {});
};

const verifyParentCredentialsByUsername = async (parentUsername, parentPassword) => {
  const u = normalizeUsername(parentUsername);
  if (!u) return null;
  const parentUser = await User.findOne({ role: "parent", username: u });
  if (!parentUser) return null;
  const match = await bcrypt.compare(parentPassword, parentUser.password);
  if (!match) return null;
  return parentUser;
};

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

    const parentUserUsername = normalizeUsername(parentUsername);
    if (!classSectionId || !studentName || !parentPassword || !parentUserUsername) {
      return res.status(400).json({
        message:
          "classSectionId, studentName, parentUsername and parentPassword are required",
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

    // Add flow: username must be globally unique (any school). Reuse/link is done via Link flow only.
    const usernameTaken = await User.findOne({ username: parentUserUsername });
    if (usernameTaken) {
      const suggestions = await suggestAvailableUsernames(
        User,
        studentName,
        parentName,
        parentPhone,
      );
      return res.status(409).json({
        message: "This username is already taken. Please choose a different one.",
        suggestions,
      });
    }

    if (!parentPhone) {
      return res.status(400).json({
        message: "parentPhone is required to create a new parent account.",
      });
    }

    const hash = await bcrypt.hash(parentPassword, 10);
    const parentUser = await User.create({
      name: parentName || `${studentName}'s Parent`,
      username: parentUserUsername,
      phone: parentPhone,
      password: hash,
      role: "parent",
      schoolId: classSection.schoolId,
    });

    // "Add" flow always creates a NEW student identity/profile.
    // Linking an existing profile is handled by /students/link endpoints.
    const identity = await StudentIdentity.create({
      parentUserId: parentUser._id,
      name: studentName,
    });
    const studentIdentityId = identity._id;

    const student = await Student.create({
      name: studentName,
      studentIdentityId,
      rollNumber,
      schoolId: classSection.schoolId,
      classSectionId: classSection._id,
      classId: classSection.classId,
      sectionId: classSection.sectionId || null,
      parentUserId: parentUser._id,
    });

    // Create an identity-linked portfolio document for this new profile
    await StudentPortfolio.create({
      studentId: student._id,
      studentIdentityId,
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
      message: "Student account created successfully",
      student,
      parent: {
        id: parentUser._id,
        name: parentUser.name,
        username: parentUser.username,
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
        const suggestions = await suggestAvailableUsernames(
          User,
          req.body.studentName,
          req.body.parentName,
          req.body.parentPhone,
        );
        return res.status(409).json({
          message: "This username is already taken. Please choose a different one.",
          suggestions,
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

// Suggest available usernames based on student/parent name + phone
exports.suggestUsernames = async (req, res) => {
  try {
    const { studentName, parentName, phone } = req.body;
    const suggestions = await suggestAvailableUsernames(
      User,
      studentName || "",
      parentName || "",
      phone || "",
      8,
    );
    res.json({ suggestions });
  } catch (error) {
    console.error("suggestUsernames error:", error);
    res.status(500).json({ message: "Error generating suggestions" });
  }
};

// Teacher: verify parent credentials and list linkable student profiles
exports.lookupLinkableStudents = async (req, res) => {
  try {
    const { parentUsername, parentPassword } = req.body;

    if (!parentUsername || !parentPassword) {
      return res.status(400).json({
        message: "parentUsername and parentPassword are required",
      });
    }

    const parentUser = await verifyParentCredentialsByUsername(
      parentUsername,
      parentPassword
    );
    if (!parentUser) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const students = await Student.find({ parentUserId: parentUser._id })
      .populate("schoolId", "name")
      .populate("classId", "name")
      .populate("sectionId", "name")
      .sort({ createdAt: -1 });

    // Ensure identities exist and dedupe by identity (latest wins)
    const byIdentity = new Map();
    for (const s of students) {
      const identityId = s.studentIdentityId
        ? s.studentIdentityId
        : await ensureStudentIdentityForStudent(s);
      const key = identityId.toString();
      if (!byIdentity.has(key)) {
        byIdentity.set(key, { student: s, studentIdentityId: identityId });
      }
    }

    // Only return identities that have no active enrollment (removed from all schools)
    const linkable = [];
    for (const { student, studentIdentityId } of byIdentity.values()) {
      const hasActive = await Student.findOne({
        studentIdentityId,
        status: "active",
      });
      if (!hasActive) {
        linkable.push({
          studentIdentityId: studentIdentityId.toString(),
          name: student.name,
          lastSchoolName: student.schoolId?.name || "",
          lastClassName: student.classId?.name || "",
          lastSectionName: student.sectionId?.name || "",
          lastStudentId: student._id.toString(),
        });
      }
    }

    if (linkable.length === 0) {
      return res.status(400).json({
        message:
          "No student found that can be linked. The student must be removed from their current school first. The parent or the previous school should remove the student from the class roster, then try again.",
        data: [],
      });
    }

    res.json({ data: linkable });
  } catch (error) {
    console.error("lookupLinkableStudents error:", error);
    res.status(500).json({ message: "Error looking up linkable students" });
  }
};

// Teacher: link an existing student profile to this class (create new enrollment)
exports.linkExistingStudentToClass = async (req, res) => {
  try {
    const { classSectionId, studentIdentityId, rollNumber } = req.body;

    if (!classSectionId || !studentIdentityId) {
      return res.status(400).json({
        message: "classSectionId and studentIdentityId are required",
      });
    }

    const classSection = await ClassSection.findById(classSectionId)
      .populate("classId", "name")
      .populate("sectionId", "name")
      .populate("schoolId", "name");

    if (!classSection) {
      return res.status(404).json({ message: "Class section not found" });
    }

    if (
      req.user.role !== "teacher" &&
      req.user.schoolId &&
      classSection.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You are not allowed to add students to this class" });
    }

    const identity = await StudentIdentity.findById(studentIdentityId);
    if (!identity) {
      return res.status(404).json({ message: "Student profile not found" });
    }

    const existingEnrollment = await Student.findOne({
      studentIdentityId: identity._id,
      classSectionId: classSection._id,
      status: "active",
    });
    if (existingEnrollment) {
      return res.status(409).json({
        message: "This student is already linked to this class",
      });
    }

    // Student must be removed (soft-deleted) from any current school before linking here
    const activeEnrollmentElsewhere = await Student.findOne({
      studentIdentityId: identity._id,
      status: "active",
    }).populate("schoolId", "name");
    if (activeEnrollmentElsewhere) {
      const schoolName = activeEnrollmentElsewhere.schoolId?.name || "another school";
      return res.status(409).json({
        message: `This student is still enrolled at ${schoolName}. They must be removed from that school first before linking here. The parent or the previous school should remove the student from the class roster.`,
      });
    }

    const previousStudent = await Student.findOne({
      studentIdentityId: identity._id,
    }).sort({ createdAt: -1 });

    const student = await Student.create({
      name: identity.name,
      studentIdentityId: identity._id,
      rollNumber,
      schoolId: classSection.schoolId,
      classSectionId: classSection._id,
      classId: classSection.classId,
      sectionId: classSection.sectionId || null,
      parentUserId: identity.parentUserId,
    });

    // Ensure portfolio is identity-linked and backfill old entries' schoolId if missing
    let portfolio =
      (await StudentPortfolio.findOne({ studentIdentityId: identity._id })) ||
      (previousStudent
        ? await StudentPortfolio.findOne({ studentId: previousStudent._id })
        : null);

    if (!portfolio) {
      portfolio = await StudentPortfolio.create({
        studentId: student._id,
        studentIdentityId: identity._id,
      });
    } else {
      let shouldSave = false;
      if (!portfolio.studentIdentityId) {
        portfolio.studentIdentityId = identity._id;
        shouldSave = true;
      }
      if (!portfolio.studentId && previousStudent?._id) {
        portfolio.studentId = previousStudent._id;
        shouldSave = true;
      }
      if (previousStudent?.schoolId) {
        const changed = applyDefaultSchoolIdToEntries(portfolio, previousStudent.schoolId);
        if (changed) shouldSave = true;
      }
      if (shouldSave) await portfolio.save();
    }

    res.status(201).json({
      message: "Student linked successfully (history preserved)",
      student,
    });
  } catch (error) {
    console.error("linkExistingStudentToClass error:", error);
    res.status(500).json({ message: "Error linking student to class" });
  }
};

// Get all active students for the school (school_admin dashboard list)
exports.getStudentsBySchool = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(403).json({
        message: "School context required to list students",
      });
    }

    const students = await Student.find({ schoolId, status: "active" })
      .populate("parentUserId", "name")
      .populate("classId", "name")
      .populate("sectionId", "name")
      .populate("classSectionId")
      .sort({ name: 1, createdAt: 1 });

    const classSectionIds = [
      ...new Set(
        students
          .map((s) => s.classSectionId?._id || s.classSectionId)
          .filter(Boolean)
      ),
    ];

    const teacherNameByClassSection = new Map();
    if (classSectionIds.length > 0) {
      const assignments = await TeacherAssignment.find({
        schoolId,
        classSectionId: { $in: classSectionIds },
        status: "active",
      })
        .populate({ path: "teacherId", populate: { path: "userId", select: "name" } })
        .sort({ role: 1 }); // class_teacher before subject_teacher if we had role sort
      for (const a of assignments) {
        const csId = (a.classSectionId && a.classSectionId._id ? a.classSectionId._id : a.classSectionId).toString();
        if (!teacherNameByClassSection.has(csId)) {
          const name = a.teacherId?.userId?.name || a.teacherId?.name || "";
          teacherNameByClassSection.set(csId, name);
        }
      }
    }

    const data = students.map((s) => {
      const csId = (s.classSectionId && s.classSectionId._id ? s.classSectionId._id : s.classSectionId)?.toString();
      return {
        _id: s._id,
        name: s.name,
        rollNumber: s.rollNumber,
        parentName: s.parentUserId?.name || "",
        className: s.classId?.name || "",
        sectionName: s.sectionId?.name || "",
        classSectionId: csId,
        teacherName: csId ? teacherNameByClassSection.get(csId) || "" : "",
      };
    });

    res.json({ data });
  } catch (error) {
    console.error("getStudentsBySchool error:", error);
    res.status(500).json({ message: "Error fetching students" });
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

    const students = await Student.find({ classSectionId, status: "active" })
      .populate("parentUserId", "name username")
      .select("name rollNumber classSectionId parentUserId")
      .sort({ createdAt: 1 });

    const formatted = students.map((s) => ({
      _id: s._id,
      name: s.name,
      rollNumber: s.rollNumber,
      parentName: s.parentUserId?.name || "",
      parentUsername: s.parentUserId?.username || "",
    }));

    res.json({ data: formatted });
  } catch (error) {
    console.error("getStudentsForClassSection error:", error);
    res.status(500).json({ message: "Error fetching students for class" });
  }
};

// Get all students across the teacher's assigned classes (with optional server-side search by name)
exports.getStudentsForTeacher = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) {
      return res.status(403).json({ message: "Teacher profile not found" });
    }
    const assignments = await TeacherAssignment.find({
      teacherId: teacher._id,
      status: "active",
    })
      .select("classSectionId")
      .lean();
    const classSectionIds = assignments.map((a) => a.classSectionId).filter(Boolean);
    if (classSectionIds.length === 0) {
      return res.json({ data: [], classes: [] });
    }
    const filter = {
      classSectionId: { $in: classSectionIds },
      status: "active",
    };
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      filter.name = { $regex: escapeRegex(search), $options: "i" };
    }
    const students = await Student.find(filter)
      .populate("classSectionId")
      .populate("classId", "name")
      .populate("sectionId", "name")
      .select("name rollNumber classSectionId classId sectionId")
      .sort("name")
      .lean();
    const classList = await ClassSection.find({ _id: { $in: classSectionIds } })
      .populate("classId", "name")
      .populate("sectionId", "name")
      .lean();
    const classes = classList.map((cs) => ({
      _id: cs._id,
      className: cs.classId?.name || "",
      sectionName: cs.sectionId?.name || "",
    }));
    const data = students.map((s) => ({
      _id: s._id,
      name: s.name,
      rollNumber: s.rollNumber || "",
      classSectionId: s.classSectionId?._id || s.classSectionId,
      className: s.classId?.name || s.classSectionId?.classId?.name || "",
      sectionName: s.sectionId?.name || s.classSectionId?.sectionId?.name || "",
    }));
    res.json({ data, classes });
  } catch (error) {
    console.error("getStudentsForTeacher error:", error);
    res.status(500).json({ message: "Error fetching students" });
  }
};

// Normalize name for grouping same child across enrollments
const normalizedNameKey = (name) =>
  (name || "").trim().toLowerCase().replace(/\s+/g, " ");

// Get all children for the logged-in parent (one card per child, not per enrollment)
exports.getMyChildren = async (req, res) => {
  try {
    const parentUserId = req.user.id;

    const students = await Student.find({ parentUserId })
      .populate("classSectionId")
      .populate("classId", "name")
      .populate("sectionId", "name")
      .populate("schoolId", "name")
      .sort({ createdAt: -1 });

    // One card per child: group by identity if present, else by normalized name (same child in different schools)
    const byChild = new Map();
    for (const s of students) {
      const identityId = s.studentIdentityId
        ? s.studentIdentityId.toString()
        : null;
      const nameKey = normalizedNameKey(s.name);
      const key = identityId || `name:${nameKey}`;

      const existing = byChild.get(key);
      const preferThis =
        !existing ||
        (s.status === "active" && existing.status !== "active") ||
        (s.status === existing.status && s.createdAt > existing.createdAt);

      if (preferThis) {
        byChild.set(key, s);
      }
    }

    const data = Array.from(byChild.values()).map((s) => ({
      _id: s._id,
      studentIdentityId: s.studentIdentityId,
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

  // Parents can access their own child across institutions.
  // School-bound access control applies to staff roles.
  if (req.user.role !== "parent") {
    if (req.user.schoolId && student.schoolId.toString() !== req.user.schoolId.toString()) {
      return {
        error: {
          status: 403,
          message: "You are not allowed to access this student",
        },
      };
    }
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

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    let shouldSave = false;
    if (!portfolio.studentIdentityId) {
      portfolio.studentIdentityId = studentIdentityId;
      shouldSave = true;
    }
    if (!portfolio.studentId) {
      portfolio.studentId = student._id;
      shouldSave = true;
    }
    const changed = applyDefaultSchoolIdToEntries(portfolio, student.schoolId);
    if (changed) shouldSave = true;
    if (shouldSave) await portfolio.save();

    const allSchoolIds = [
      student.schoolId?.toString(),
      ...(portfolio.academic || []).map((e) => e.schoolId?.toString()),
      ...(portfolio.behavior || []).map((e) => e.schoolId?.toString()),
      ...(portfolio.skills || []).map((e) => e.schoolId?.toString()),
      ...(portfolio.wellbeing || []).map((e) => e.schoolId?.toString()),
    ].filter(Boolean);

    const schoolsById = await loadSchoolsById(allSchoolIds);
    const currentSchoolId = student.schoolId?.toString();

    const withInstitutionTag = (entry) => {
      const sid = entry.schoolId ? entry.schoolId.toString() : undefined;
      const isPreviousInstitution =
        !!sid && !!currentSchoolId && sid !== currentSchoolId;
      return {
        ...entry,
        schoolId: sid,
        institutionTag: isPreviousInstitution
          ? "Previous Institution"
          : "Current Institution",
        institutionName: sid ? schoolsById[sid]?.name : undefined,
        isPreviousInstitution,
      };
    };

    const portfolioObj = portfolio.toObject();
    res.json({
      data: {
        ...portfolioObj,
        studentId: portfolioObj.studentId?.toString(),
        studentIdentityId: portfolioObj.studentIdentityId?.toString(),
        academic: (portfolioObj.academic || []).map(withInstitutionTag),
        behavior: (portfolioObj.behavior || []).map(withInstitutionTag),
        skills: (portfolioObj.skills || []).map(withInstitutionTag),
        wellbeing: (portfolioObj.wellbeing || []).map(withInstitutionTag),
      },
      meta: {
        currentSchoolId,
        schoolsById,
      },
    });
  } catch (error) {
    console.error("getStudentPortfolio error:", error);
    res.status(500).json({ message: "Error fetching student portfolio" });
  }
};

// Add an academic record to a student's portfolio
exports.addAcademicRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      term,
      subject,
      assessmentType,
      testName,
      marksObtained,
      maxMarks,
      grade,
      remarks,
      date,
      evidenceFilesB64,
    } = req.body;

    if (!subject) {
      return res.status(400).json({ message: "Subject is required" });
    }

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    // Upload evidence: multipart (multer) and/or JSON base64 (Expo — reliable on RN)
    const evidenceFiles = [];
    const hadMultipart = req.files && req.files.length > 0;
    const b64List = Array.isArray(evidenceFilesB64) ? evidenceFilesB64 : [];

    if (hadMultipart) {
      for (const file of req.files) {
        try {
          const result = await uploadBuffer(file.buffer, {
            folder: `educa/evidence/${student._id}`,
            original_filename: file.originalname,
          });
          evidenceFiles.push({
            url: result.secure_url,
            publicId: result.public_id,
            originalName: file.originalname,
            resourceType: result.resource_type,
          });
        } catch (uploadErr) {
          console.error("Cloudinary upload error:", uploadErr.message);
        }
      }
    }

    if (b64List.length > 0) {
      const max = Math.min(b64List.length, 5);
      for (let i = 0; i < max; i++) {
        const item = b64List[i];
        if (!item || typeof item.data !== "string") continue;
        let raw = item.data.trim();
        const comma = raw.indexOf("base64,");
        if (comma !== -1) raw = raw.slice(comma + 7);
        const mime = item.mime || "image/jpeg";
        if (!mime.startsWith("image/") && mime !== "application/pdf") continue;
        try {
          const buffer = Buffer.from(raw, "base64");
          if (!buffer.length) continue;
          const result = await uploadBuffer(buffer, {
            folder: `educa/evidence/${student._id}`,
            original_filename: item.name || `evidence_${i + 1}`,
          });
          evidenceFiles.push({
            url: result.secure_url,
            publicId: result.public_id,
            originalName: item.name || `evidence_${i + 1}`,
            resourceType: result.resource_type,
          });
        } catch (uploadErr) {
          console.error("Cloudinary upload error (b64):", uploadErr.message);
        }
      }
    }

    if ((hadMultipart || b64List.length > 0) && evidenceFiles.length === 0) {
      return res.status(503).json({
        message:
          "Evidence upload failed (e.g. Cloudinary not configured). Set CLOUDINARY_* in .env and try again.",
      });
    }

    const entryDate = date ? new Date(date) : new Date();
    const weekNumber = getWeekNumber(entryDate);

    portfolio.academic.push({
      schoolId: student.schoolId,
      weekNumber,
      term,
      assessmentType,
      subject,
      testName,
      marksObtained: marksObtained !== undefined ? Number(marksObtained) : undefined,
      maxMarks: maxMarks !== undefined ? Number(maxMarks) : undefined,
      grade,
      remarks,
      evidenceFiles,
      date: entryDate,
    });

    await portfolio.save();
    res.json({ message: "Academic record added successfully", data: portfolio });
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
      respect,
      attention,
      interaction,
      attendanceBehavior,
      participation,
      socialInteraction,
      teacherComment,
      teacherRemark,
    } = req.body;

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    const entryDate = date ? new Date(date) : new Date();
    const weekNumber = getWeekNumber(entryDate);

    portfolio.behavior.push({
      schoolId: student.schoolId,
      weekNumber,
      date: entryDate,
      discipline,
      respect,
      attention,
      interaction,
      attendanceBehavior,
      participation,
      socialInteraction,
      teacherComment,
      teacherRemark,
    });

    await portfolio.save();
    res.json({ message: "Behavior record added successfully", data: portfolio });
  } catch (error) {
    console.error("addBehaviorRecord error:", error);
    res.status(500).json({ message: "Error adding behavior record" });
  }
};

// Add a skill record to a student's portfolio
exports.addSkillRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { area, rating, ratingLabel, remark, date } = req.body;

    if (!area) {
      return res.status(400).json({ message: "Skill area is required" });
    }

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    const entryDate = date ? new Date(date) : new Date();
    const weekNumber = getWeekNumber(entryDate);

    portfolio.skills.push({
      schoolId: student.schoolId,
      weekNumber,
      area,
      ratingLabel,
      rating,
      remark,
      date: entryDate,
    });

    await portfolio.save();
    res.json({ message: "Skill record added successfully", data: portfolio });
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

// Add a wellbeing record to a student's portfolio
exports.addWellbeingRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, tags, teacherRemark, date } = req.body;

    if (!status) {
      return res.status(400).json({ message: "Wellbeing status is required" });
    }

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    const entryDate = date ? new Date(date) : new Date();
    const weekNumber = getWeekNumber(entryDate);

    portfolio.wellbeing.push({
      schoolId: student.schoolId,
      weekNumber,
      date: entryDate,
      status,
      tags: Array.isArray(tags) ? tags : [],
      teacherRemark,
    });

    await portfolio.save();
    res.json({ message: "Wellbeing record added successfully", data: portfolio });
  } catch (error) {
    console.error("addWellbeingRecord error:", error);
    res.status(500).json({ message: "Error adding wellbeing record" });
  }
};

// Get AI-powered holistic analysis for a student
exports.getAIAnalysis = async (req, res) => {
  try {
    const { id } = req.params;

    const { error, student } = await ensureTeacherOrAdminCanAccessStudent(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const studentIdentityId = await ensureStudentIdentityForStudent(student);

    const portfolio = await resolvePortfolioForStudent(student, studentIdentityId);

    if (portfolioEntryCount(portfolio) === 0) {
      return res.json({
        data: {
          academicWeekly: [],
          behaviorWeekly: [],
          skillWeekly: [],
          holisticScore: { academic: null, behavior: null, skill: null, overall: null },
          trends: { academic: "stable", behavior: "stable", skill: "stable" },
          emotionalRisk: { isAtRisk: false, consecutiveLowWeeks: 0, riskTagCount: 0, recentStatus: null },
          aiInsights: ["No portfolio data available yet. Start adding weekly records to unlock AI insights."],
        },
      });
    }

    const analysis = await analyzePortfolio(portfolio, student.name);
    res.json({ data: analysis });
  } catch (error) {
    console.error("getAIAnalysis error:", error);
    res.status(500).json({ message: "Error generating AI analysis" });
  }
};

// Remove a student from the class (soft delete: set status to inactive)
// Student record and history are preserved; they can be linked to another school after removal
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
        .json({ message: "You are not allowed to remove this student" });
    }

    if (student.status === "inactive") {
      return res.status(400).json({
        message: "Student is already removed from this class",
      });
    }

    await Student.findByIdAndUpdate(id, { status: "inactive" });

    res.json({
      message:
        "Student removed from class successfully. They can now be linked to another school.",
    });
  } catch (error) {
    console.error("deleteStudent error:", error);
    res.status(500).json({ message: "Error removing student" });
  }
};


