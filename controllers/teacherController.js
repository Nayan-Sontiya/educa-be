const { default: mongoose } = require("mongoose");
const jwt = require("jsonwebtoken");
const Teacher = require("../models/Teacher");
const User = require("../models/User");
const Subject = require("../models/Subject");
const bcrypt = require("bcryptjs");
const { normalizePhone, pickPhoneFromBody } = require("../utils/phone");

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 🧾 1️⃣ Teacher self-register
exports.registerTeacher = async (req, res) => {
  try {
    const { name, email, password, schoolId, subjectIds, subject } = req.body;
    const phoneRaw = pickPhoneFromBody(req.body);

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }
    if (!schoolId) {
      return res.status(400).json({ message: "School is required" });
    }
    if (!phoneRaw) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const existingUser = await User.findOne({ email: email.trim() });
    if (existingUser)
      return res.status(400).json({ message: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    const pn = normalizePhone(phoneRaw);
    const userPayload = {
      name: name.trim(),
      email: email.trim(),
      password: hash,
      role: "teacher",
      schoolId,
      phone: phoneRaw,
      ...(pn ? { phoneNormalized: pn } : {}),
    };

    const user = await User.create(userPayload);

    let resolvedSubjectIds = Array.isArray(subjectIds) ? subjectIds : [];
    if (
      resolvedSubjectIds.length === 0 &&
      subject != null &&
      String(subject).trim() !== "" &&
      schoolId
    ) {
      const subDoc = await Subject.findOne({
        schoolId,
        name: new RegExp(`^${escapeRegex(String(subject).trim())}$`, "i"),
      })
        .select("_id")
        .lean();
      if (subDoc) resolvedSubjectIds = [subDoc._id];
    }

    const teacher = await Teacher.create({
      userId: user._id,
      schoolId,
      subjectIds: resolvedSubjectIds,
      phone: phoneRaw,
    });

    const userResponse = {
      id: user._id.toString(),
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      schoolId: user.schoolId,
      createdAt: user.createdAt,
      teacherStatus: teacher.status,
    };

    const body = {
      message: "Teacher registered successfully, pending approval",
      user: userResponse,
      teacher,
    };

    // Only active teachers may receive a session (e.g. added by school admin as active).
    // Self-service signup is pending until an admin approves — no JWT.
    if (teacher.status === "active") {
      body.token = jwt.sign(
        { id: user._id, role: user.role, schoolId: user.schoolId },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );
    }

    res.status(201).json(body);
  } catch (error) {
    console.error("registerTeacher:", error?.message || error);
    if (error?.name === "ValidationError") {
      const errors = Object.values(error.errors || {}).map((e) => e.message);
      return res.status(400).json({
        message: errors[0] || "Validation failed",
        errors,
      });
    }
    if (error?.name === "CastError") {
      return res.status(400).json({ message: "Invalid school or reference id" });
    }
    if (error?.code === 11000) {
      return res.status(400).json({ message: "Email or username already registered" });
    }
    res.status(500).json({
      message: "Error registering teacher",
      details: error?.message || String(error),
    });
  }
};

// 🧾 0️⃣ Add Teacher by School Admin
exports.addTeacherBySchoolAdmin = async (req, res) => {
  try {
    const { name, email, subjectIds, status } = req.body;
    const phoneRaw = pickPhoneFromBody(req.body);

    if (!name || !email)
      return res.status(400).json({ message: "Name and email are required" });

    // Prevent duplicates
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email already exists" });

    // School ID comes from the school_admin user
    const schoolId = req.user.schoolId;

    // Generate temporary password (optional)
    const tempPassword = Math.random().toString(36).slice(2, 10); // 8-char password

    const userPayload = {
      name,
      email,
      password: tempPassword,
      role: "teacher",
      schoolId,
    };
    if (phoneRaw) {
      userPayload.phone = phoneRaw;
      const pn = normalizePhone(phoneRaw);
      if (pn) userPayload.phoneNormalized = pn;
    }

    // Create user
    const user = await User.create(userPayload);

    // Create teacher profile (direct approved)
    const teacher = await Teacher.create({
      userId: user._id,
      schoolId,
      subjectIds: subjectIds || [],
      phone: phoneRaw || undefined,
      status,
    });

    res.status(201).json({
      message: "Teacher added successfully",
      teacher,
      tempPassword, // Optional: you can remove this if you don't want to show it.
    });
  } catch (error) {
    console.error("Add Teacher Error:", error);
    res.status(500).json({ message: "Error adding teacher" });
  }
};

// 🧾 6️⃣ Update Teacher (Admin / School Admin)
exports.updateTeacher = async (req, res) => {
  try {
    const { name, email, phone, subjectIds, status, password } = req.body;

    const teacherId = req.params.id;
    // Step 1: Check teacher exists
    const teacher = await Teacher.findById(teacherId).populate("userId");
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const userId = teacher.userId._id;

    // Step 2: Email conflict check (if email updated)
    if (email && email !== teacher.userId.email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    // Step 3–4: Build User + Teacher updates (keep User.phone in sync with Teacher.phone)
    const userUpdates = {};
    const teacherUpdates = {};
    if (name) userUpdates.name = name;
    if (email) userUpdates.email = email;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      userUpdates.password = hash; // 🔐 Hash password if provided
    }
    if (phone !== undefined) {
      const trimmed =
        phone == null || String(phone).trim() === ""
          ? undefined
          : String(phone).trim();
      teacherUpdates.phone = trimmed;
      userUpdates.phone = trimmed;
      userUpdates.phoneNormalized = trimmed
        ? normalizePhone(trimmed) || undefined
        : undefined;
    }
    if (subjectIds !== undefined) teacherUpdates.subjectIds = subjectIds;
    if (status) teacherUpdates.status = status;

    await User.findByIdAndUpdate(userId, userUpdates);

    const teacherQuery =
      Object.keys(teacherUpdates).length > 0
        ? Teacher.findByIdAndUpdate(teacherId, teacherUpdates, { new: true })
        : Teacher.findById(teacherId);
    const updatedTeacher = await teacherQuery
      .populate("userId", "name email role phone")
      .populate("subjectIds", "name");

    res.json({
      message: "Teacher updated successfully",
      teacher: updatedTeacher,
    });
  } catch (error) {
    console.error("Update Teacher Error:", error);
    res.status(500).json({ message: "Error updating teacher" });
  }
};

// 🧾 2️⃣ Get all teachers (Admin / School Admin)
exports.getAllTeachers = async (req, res) => {
  try {
    const schoolId = new mongoose.Types.ObjectId(req.user.schoolId);
    const teachers = await Teacher.find({ schoolId })
      .populate("userId", "name email role phone")
      .populate("schoolId", "name")
      .populate("subjectIds", "name");

    const formattedTeachers = teachers.map((t) => ({
      id: t._id,
      _id: t._id,
      userId: t.userId?._id,
      name: t.userId?.name,
      email: t.userId?.email,
      role: t.userId?.role,
      school: t.schoolId?.name,
      status: t.status,
      subjectIds: t.subjectIds || [],
      subjects: t.subjectIds?.map((s) => s.name).join(", ") || "",
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      phone: t.userId?.phone || t.phone,
    }));

    res.status(200).json({
      data: formattedTeachers,
      total: formattedTeachers.length,
    });
  } catch (error) {
    console.error("Error fetching teachers:", error.message);
    res.status(500).json({
      data: [],
      total: 0,
    });
  }
};

// 🧾 3️⃣ Approve or Reject teacher (Admin/School Admin)
exports.updateTeacherStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const dbStatus = status === "approved" ? "active" : "rejected";

    const teacher = await Teacher.findByIdAndUpdate(
      req.params.id,
      { status: dbStatus },
      { new: true }
    ).populate("userId", "name email role phone");

    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    res.json({
      message:
        status === "approved"
          ? "Teacher approved successfully"
          : "Teacher rejected successfully",
      teacher,
    });
  } catch (error) {
    res.status(500).json({ message: "Error updating teacher status" });
  }
};

// 🧾 4️⃣ Teacher can view/update their own profile
exports.getMyProfile = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id })
      .populate("userId", "name email role phone")
      .populate("schoolId", "name");

    if (!teacher) return res.status(404).json({ message: "Profile not found" });

    res.json(teacher);
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile" });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const teacher = await Teacher.findOneAndUpdate(
      { userId: req.user.id },
      req.body,
      { new: true }
    );
    if (!teacher) return res.status(404).json({ message: "Profile not found" });
    res.json({ message: "Profile updated", teacher });
  } catch (error) {
    res.status(500).json({ message: "Error updating profile" });
  }
};

// 🧾 5️⃣ Delete a teacher (Admin only)
exports.deleteTeacher = async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    await User.findByIdAndDelete(teacher.userId);
    await Teacher.findByIdAndDelete(req.params.id);

    res.json({ message: "Teacher deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting teacher" });
  }
};
