// controllers/attendanceController.js
const Attendance = require("../models/Attendance");
const Student = require("../models/Student");
const ClassSection = require("../models/ClassSection");
const StudentCalendar = require("../models/StudentCalendar");
const ParentAlert = require("../models/ParentAlert");
const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");

// Get attendance list for a class section on a specific date
exports.getAttendanceList = async (req, res) => {
  try {
    const { classSectionId, date } = req.query;

    if (!classSectionId || !date) {
      return res.status(400).json({
        message: "classSectionId and date are required",
      });
    }

    // Verify teacher has access to this class section
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ userId: req.user.id });
      if (!teacher) {
        return res.status(403).json({ message: "Teacher profile not found" });
      }

      const assignment = await TeacherAssignment.findOne({
        schoolId: req.user.schoolId,
        teacherId: teacher._id,
        classSectionId,
        status: "active",
      });

      if (!assignment) {
        return res.status(403).json({
          message: "You are not assigned to this class section",
        });
      }
    }

    // Get all students in this class section
    const students = await Student.find({ classSectionId })
      .select("_id name rollNumber")
      .sort({ rollNumber: 1, name: 1 });

    // Get existing attendance for this date
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);
    const endDate = new Date(attendanceDate);
    endDate.setHours(23, 59, 59, 999);

    const existingAttendance = await Attendance.find({
      classSectionId,
      date: { $gte: attendanceDate, $lte: endDate },
    });

    const attendanceMap = {};
    existingAttendance.forEach((att) => {
      attendanceMap[att.studentId.toString()] = {
        status: att.status,
        remarks: att.remarks,
        _id: att._id,
      };
    });

    // Format response
    const attendanceList = students.map((student) => ({
      studentId: student._id,
      studentName: student.name,
      rollNumber: student.rollNumber,
      attendance: attendanceMap[student._id.toString()] || null,
    }));

    res.json({ data: attendanceList, date: attendanceDate });
  } catch (error) {
    console.error("getAttendanceList error:", error);
    res.status(500).json({ message: "Error fetching attendance list" });
  }
};

// Mark attendance for multiple students (bulk update)
exports.markAttendance = async (req, res) => {
  try {
    const { classSectionId, date, attendanceData } = req.body;

    if (!classSectionId || !date || !Array.isArray(attendanceData)) {
      return res.status(400).json({
        message:
          "classSectionId, date, and attendanceData array are required",
      });
    }

    // Verify teacher has access
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ userId: req.user.id });
      if (!teacher) {
        return res.status(403).json({ message: "Teacher profile not found" });
      }

      const assignment = await TeacherAssignment.findOne({
        schoolId: req.user.schoolId,
        teacherId: teacher._id,
        classSectionId,
        status: "active",
      });

      if (!assignment) {
        return res.status(403).json({
          message: "You are not assigned to this class section",
        });
      }
    }

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);
    const startOfDay = new Date(attendanceDate);
    const endOfDay = new Date(attendanceDate);
    endOfDay.setHours(23, 59, 59, 999);

    const results = [];
    const alertsToCreate = [];

    for (const item of attendanceData) {
      const { studentId, status, remarks } = item;

      if (!studentId || !status || !["P", "A", "L"].includes(status)) {
        continue;
      }

      // Upsert attendance (update if exists, create if not)
      const attendance = await Attendance.findOneAndUpdate(
        {
          studentId,
          date: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        },
        {
          studentId,
          classSectionId,
          date: new Date(attendanceDate),
          status,
          remarks: remarks || "",
          markedBy: req.user.id,
        },
        { upsert: true, new: true }
      );

      results.push(attendance);

      // Sync to Student Calendar (normalize date will happen inside sync function)
      await syncAttendanceToCalendar(studentId, attendanceDate, status);

      // Create parent alert if absent
      if (status === "A") {
        const student = await Student.findById(studentId).populate(
          "parentUserId"
        );
        if (student && student.parentUserId) {
          alertsToCreate.push({
            parentUserId: student.parentUserId._id,
            studentId: student._id,
            attendanceId: attendance._id,
            type: "absence",
            date: attendanceDate,
            message: `${student.name} was marked absent on ${attendanceDate.toLocaleDateString()}`,
          });
        }
      }
    }

    // Bulk create alerts
    if (alertsToCreate.length > 0) {
      await ParentAlert.insertMany(alertsToCreate);
    }

    res.json({
      message: "Attendance marked successfully",
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("markAttendance error:", error);
    res.status(500).json({ message: "Error marking attendance" });
  }
};

// Update single attendance record
exports.updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    if (!status || !["P", "A", "L"].includes(status)) {
      return res.status(400).json({
        message: "Valid status (P, A, or L) is required",
      });
    }

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    // Verify access
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ userId: req.user.id });
      if (!teacher) {
        return res.status(403).json({ message: "Teacher profile not found" });
      }

      const assignment = await TeacherAssignment.findOne({
        schoolId: req.user.schoolId,
        teacherId: teacher._id,
        classSectionId: attendance.classSectionId,
        status: "active",
      });

      if (!assignment) {
        return res.status(403).json({
          message: "You are not assigned to this class section",
        });
      }
    }

    const oldStatus = attendance.status;
    attendance.status = status;
    if (remarks !== undefined) attendance.remarks = remarks;
    await attendance.save();

    // Sync to calendar
    await syncAttendanceToCalendar(
      attendance.studentId,
      attendance.date,
      status
    );

    // Handle alerts: create if changed to A, remove if changed from A
    if (status === "A" && oldStatus !== "A") {
      const student = await Student.findById(attendance.studentId).populate(
        "parentUserId"
      );
      if (student && student.parentUserId) {
        await ParentAlert.create({
          parentUserId: student.parentUserId._id,
          studentId: student._id,
          attendanceId: attendance._id,
          type: "absence",
          date: attendance.date,
          message: `${student.name} was marked absent on ${attendance.date.toLocaleDateString()}`,
        });
      }
    } else if (oldStatus === "A" && status !== "A") {
      // Remove absence alert if status changed from A
      await ParentAlert.deleteMany({
        studentId: attendance.studentId,
        attendanceId: attendance._id,
        type: "absence",
      });
    }

    res.json({
      message: "Attendance updated successfully",
      data: attendance,
    });
  } catch (error) {
    console.error("updateAttendance error:", error);
    res.status(500).json({ message: "Error updating attendance" });
  }
};

// Helper: Normalize date to local midnight for consistent storage
// This ensures dates match the calendar display (IST timezone)
function normalizeDateToLocalMidnight(date) {
  const dateObj = new Date(date);
  // Get the date components in local timezone
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  // Create a new date at local midnight
  const localMidnight = new Date(year, month, day, 0, 0, 0, 0);
  return localMidnight;
}

// Helper: Get date string in YYYY-MM-DD format from any date format
// Uses local timezone to match calendar display
function getDateString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Sync attendance to student calendar
async function syncAttendanceToCalendar(studentId, date, status) {
  try {
    let calendar = await StudentCalendar.findOne({ studentId });

    if (!calendar) {
      calendar = await StudentCalendar.create({ studentId, entries: [] });
    }

    // Normalize date to local midnight for consistent storage
    // This ensures dates match the calendar display (IST timezone)
    const normalizedDate = normalizeDateToLocalMidnight(date);
    const targetDateStr = getDateString(normalizedDate);
    
    // Find existing attendance entry for this date
    // Normalize both sides for comparison
    const existingIndex = calendar.entries.findIndex(
      (entry) => {
        if (entry.type !== "attendance") return false;
        const entryDateStr = getDateString(entry.date);
        return entryDateStr === targetDateStr;
      }
    );

    const entry = {
      date: normalizedDate,
      type: "attendance",
      attendanceStatus: status,
    };

    if (existingIndex >= 0) {
      // Update existing entry
      const oldStatus = calendar.entries[existingIndex].attendanceStatus;
      calendar.entries[existingIndex] = entry;
      console.log(`Updated attendance: studentId=${studentId}, date=${targetDateStr}, status=${oldStatus} -> ${status}`);
    } else {
      // Add new entry
      calendar.entries.push(entry);
      console.log(`Added attendance: studentId=${studentId}, date=${targetDateStr}, status=${status}`);
    }

    await calendar.save();
    
    // Verify the entry was saved correctly
    const savedCalendar = await StudentCalendar.findOne({ studentId });
    const savedEntry = savedCalendar.entries.find(
      (e) => e.type === "attendance" && getDateString(e.date) === targetDateStr
    );
    if (savedEntry && savedEntry.attendanceStatus !== status) {
      console.error(`WARNING: Entry status mismatch! Expected ${status}, got ${savedEntry.attendanceStatus}`);
    }
  } catch (error) {
    console.error("syncAttendanceToCalendar error:", error);
    console.error("Error details:", {
      studentId,
      date,
      status,
      error: error.message,
      stack: error.stack,
    });
  }
}

// Get attendance statistics for a class section
exports.getAttendanceStats = async (req, res) => {
  try {
    const { classSectionId, startDate, endDate } = req.query;

    if (!classSectionId || !startDate || !endDate) {
      return res.status(400).json({
        message: "classSectionId, startDate, and endDate are required",
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const attendance = await Attendance.find({
      classSectionId,
      date: { $gte: start, $lte: end },
    });

    const stats = {
      totalDays: Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
      present: 0,
      absent: 0,
      leave: 0,
      byStudent: {},
    };

    attendance.forEach((att) => {
      const studentId = att.studentId.toString();
      if (!stats.byStudent[studentId]) {
        stats.byStudent[studentId] = { present: 0, absent: 0, leave: 0 };
      }

      if (att.status === "P") {
        stats.present++;
        stats.byStudent[studentId].present++;
      } else if (att.status === "A") {
        stats.absent++;
        stats.byStudent[studentId].absent++;
      } else if (att.status === "L") {
        stats.leave++;
        stats.byStudent[studentId].leave++;
      }
    });

    res.json({ data: stats });
  } catch (error) {
    console.error("getAttendanceStats error:", error);
    res.status(500).json({ message: "Error fetching attendance statistics" });
  }
};
