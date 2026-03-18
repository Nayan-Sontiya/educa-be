// controllers/studentLeaveController.js
const StudentLeave = require("../models/StudentLeave");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");
const Attendance = require("../models/Attendance");
const StudentCalendar = require("../models/StudentCalendar");
const ParentAlert = require("../models/ParentAlert");
// Notification model does not exist yet; notifications are best-effort via ParentAlert only

// ── helpers ─────────────────────────────────────────────────────────────────

function countDays(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate);
  const end = new Date(endDate);
  cur.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++; // exclude Sundays
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function normalizeMidnight(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function dateString(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function syncCalendarLeave(studentId, date) {
  let cal = await StudentCalendar.findOne({ studentId });
  if (!cal) cal = await StudentCalendar.create({ studentId, entries: [] });
  const target = dateString(normalizeMidnight(date));
  const idx = cal.entries.findIndex(
    (e) => e.type === "attendance" && dateString(e.date) === target
  );
  const entry = { date: normalizeMidnight(date), type: "attendance", attendanceStatus: "L" };
  if (idx >= 0) cal.entries[idx] = entry;
  else cal.entries.push(entry);
  await cal.save();
}

// Resolve class teacher user id for a student (prefer class_teacher role, fall back to any)
async function resolveTeacherUserId(student) {
  let assignment = await TeacherAssignment.findOne({
    classSectionId: student.classSectionId,
    schoolId: student.schoolId,
    role: "class_teacher",
    status: "active",
  }).select("teacherId").lean();

  if (!assignment) {
    assignment = await TeacherAssignment.findOne({
      classSectionId: student.classSectionId,
      schoolId: student.schoolId,
      status: "active",
    }).select("teacherId").lean();
  }
  if (!assignment) return null;
  const teacher = await Teacher.findById(assignment.teacherId).select("userId").lean();
  return teacher?.userId || null;
}

// ── routes ───────────────────────────────────────────────────────────────────

// POST /student-leaves  (parent only)
// Body: { studentId, startDate, endDate, reason }
exports.applyLeave = async (req, res) => {
  try {
    const parentUserId = req.user.id;
    const { studentId, startDate, endDate, reason } = req.body;

    if (!studentId || !startDate || !endDate || !reason?.trim()) {
      return res.status(400).json({ message: "studentId, startDate, endDate, and reason are required" });
    }

    const student = await Student.findOne({ _id: studentId, parentUserId, status: "active" });
    if (!student) {
      return res.status(403).json({ message: "Student not found or you are not the parent" });
    }

    const start = normalizeMidnight(startDate);
    const end = normalizeMidnight(endDate);
    if (start > end) {
      return res.status(400).json({ message: "End date must be on or after start date" });
    }

    const teacherUserId = await resolveTeacherUserId(student);
    if (!teacherUserId) {
      return res.status(400).json({ message: "No teacher assigned for this student's class yet" });
    }

    const days = countDays(start, end);
    if (days === 0) {
      return res.status(400).json({ message: "Selected dates have no school days (all Sundays)" });
    }

    const leave = await StudentLeave.create({
      studentId: student._id,
      parentUserId,
      schoolId: student.schoolId,
      teacherUserId,
      startDate: start,
      endDate: end,
      days,
      reason: reason.trim(),
    });

    // Teacher notification via ParentAlert-style in the future; skipped for now

    res.status(201).json({ message: "Leave request submitted", data: leave });
  } catch (err) {
    console.error("applyLeave error:", err);
    res.status(500).json({ message: "Error submitting leave request" });
  }
};

// GET /student-leaves/for-student/:studentId  (parent – own child only)
exports.getLeavesForStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findOne({ _id: studentId, parentUserId: req.user.id });
    if (!student) return res.status(403).json({ message: "Access denied" });

    const leaves = await StudentLeave.find({ studentId })
      .sort({ startDate: -1 })
      .lean();
    res.json({ data: leaves });
  } catch (err) {
    console.error("getLeavesForStudent error:", err);
    res.status(500).json({ message: "Error fetching leaves" });
  }
};

// GET /student-leaves/for-teacher  (teacher only — pending + all for their classes)
exports.getLeavesForTeacher = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { teacherUserId: req.user.id };
    if (status) filter.status = status;

    const leaves = await StudentLeave.find(filter)
      .populate("studentId", "name rollNumber classId sectionId classSectionId")
      .populate({ path: "studentId", populate: [{ path: "classId", select: "name" }, { path: "sectionId", select: "name" }] })
      .populate("parentUserId", "name")
      .sort({ createdAt: -1 })
      .lean();

    const data = leaves.map((l) => {
      const s = l.studentId;
      return {
        ...l,
        studentName: s?.name || "",
        className: s?.classId?.name || "",
        sectionName: s?.sectionId?.name || "",
      };
    });
    res.json({ data });
  } catch (err) {
    console.error("getLeavesForTeacher error:", err);
    res.status(500).json({ message: "Error fetching leave requests" });
  }
};

// PATCH /student-leaves/:id/approve  (teacher only)
exports.approveLeave = async (req, res) => {
  try {
    const leave = await StudentLeave.findOne({
      _id: req.params.id,
      teacherUserId: req.user.id,
      status: "pending",
    });
    if (!leave) return res.status(404).json({ message: "Leave not found or already processed" });

    leave.status = "approved";
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();
    await leave.save();

    // Upsert Attendance "L" for each day in range + sync to calendar
    const student = await Student.findById(leave.studentId).select("classSectionId parentUserId name").lean();
    const dates = [];
    const cur = new Date(leave.startDate);
    const end = new Date(leave.endDate);
    while (cur <= end) {
      if (cur.getDay() !== 0) dates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    for (const d of dates) {
      const normalized = normalizeMidnight(d);
      const startOfDay = new Date(normalized);
      const endOfDay = new Date(normalized);
      endOfDay.setHours(23, 59, 59, 999);

      const attendance = await Attendance.findOneAndUpdate(
        { studentId: leave.studentId, date: { $gte: startOfDay, $lte: endOfDay } },
        {
          studentId: leave.studentId,
          classSectionId: student.classSectionId,
          date: normalized,
          status: "L",
          markedBy: req.user.id,
          remarks: `Leave – ${leave.reason}`,
        },
        { upsert: true, new: true }
      );

      await syncCalendarLeave(leave.studentId, normalized);

      // Parent alert for leave day (type "leave")
      if (student.parentUserId) {
        const existing = await ParentAlert.findOne({
          studentId: leave.studentId,
          attendanceId: attendance._id,
        });
        if (!existing) {
          await ParentAlert.create({
            parentUserId: student.parentUserId,
            studentId: leave.studentId,
            attendanceId: attendance._id,
            type: "leave",
            date: normalized,
            status: "unread",
            message: `${student.name}'s leave on ${normalized.toLocaleDateString()} has been approved.`,
          });
        }
      }
    }


    res.json({ message: "Leave approved", data: leave });
  } catch (err) {
    console.error("approveLeave error:", err);
    res.status(500).json({ message: "Error approving leave" });
  }
};

// PATCH /student-leaves/:id/reject  (teacher only)
// Body: { rejectionReason? }
exports.rejectLeave = async (req, res) => {
  try {
    const leave = await StudentLeave.findOne({
      _id: req.params.id,
      teacherUserId: req.user.id,
      status: "pending",
    });
    if (!leave) return res.status(404).json({ message: "Leave not found or already processed" });

    leave.status = "rejected";
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();
    if (req.body.rejectionReason) leave.rejectionReason = req.body.rejectionReason.trim();
    await leave.save();

    const student = await Student.findById(leave.studentId).select("name").lean();


    res.json({ message: "Leave rejected", data: leave });
  } catch (err) {
    console.error("rejectLeave error:", err);
    res.status(500).json({ message: "Error rejecting leave" });
  }
};
