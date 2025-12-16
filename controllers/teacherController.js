const Teacher = require("../models/Teacher");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

// 🧾 1️⃣ Teacher self-register
exports.registerTeacher = async (req, res) => {
  try {
    const { name, email, password, schoolId, subject } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email already registered" });

    // Encrypt password
    const hash = await bcrypt.hash(password, 10);

    // Create a teacher user
    const user = await User.create({
      name,
      email,
      password: hash,
      role: "teacher",
      schoolId,
    });

    // Create teacher profile in pending state
    const teacher = await Teacher.create({
      userId: user._id,
      schoolId,
      subject,
    });

    res.status(201).json({
      message: "Teacher registered successfully, pending approval",
      teacher,
    });
  } catch (error) {
    res.status(500).json({ message: "Error registering teacher", error });
  }
};

// 🧾 0️⃣ Add Teacher by School Admin
exports.addTeacherBySchoolAdmin = async (req, res) => {
  try {
    const { name, email, subject, status, phone } = req.body;

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

    // Create user
    const user = await User.create({
      name,
      email,
      password: tempPassword,
      role: "teacher",
      schoolId,
    });

    // Create teacher profile (direct approved)
    const teacher = await Teacher.create({
      userId: user._id,
      schoolId,
      subject,
      phone,
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
    const { name, email, phone, subject, status, password } = req.body;

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

    // Step 3: Update User fields
    const userUpdates = {};
    if (name) userUpdates.name = name;
    if (email) userUpdates.email = email;
    if (password) userUpdates.password = password; // 🔐 Only if provided

    await User.findByIdAndUpdate(userId, userUpdates);

    // Step 4: Update Teacher fields
    const teacherUpdates = {};
    if (phone) teacherUpdates.phone = phone;
    if (subject) teacherUpdates.subject = subject;
    if (status) teacherUpdates.status = status;

    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      teacherUpdates,
      { new: true }
    ).populate("userId", "name email role");

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
    const teachers = await Teacher.find()
      .populate("userId", "name email role")
      .populate("schoolId", "name");

    const formattedTeachers = teachers.map((t) => ({
      id: t._id,
      userId: t.userId?._id,
      name: t.userId?.name,
      email: t.userId?.email,
      role: t.userId?.role,
      school: t.schoolId?.name,
      status: t.status,
      subject: t.subject,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      phone: t.phone,
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

    const teacher = await Teacher.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("userId", "name email role");

    if (!teacher) return res.status(404).json({ message: "Teacher not found" });

    res.json({ message: `Teacher ${status} successfully`, teacher });
  } catch (error) {
    res.status(500).json({ message: "Error updating teacher status" });
  }
};

// 🧾 4️⃣ Teacher can view/update their own profile
exports.getMyProfile = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id })
      .populate("userId", "name email role")
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
