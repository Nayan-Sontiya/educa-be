// controllers/teacherAttendanceController.js
const TeacherAttendance = require("../models/TeacherAttendance");
const Teacher = require("../models/Teacher");
const School = require("../models/School");
const Leave = require("../models/Leave");

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date at local midnight for any input date */
function toMidnight(d) {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * Haversine formula – returns distance in metres between two lat/lng points.
 */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in metres
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── POST /api/teacher-attendance/mark ────────────────────────────────────────
// Body (multipart/form-data): selfie (file), latitude, longitude
exports.markAttendance = async (req, res) => {
  try {
    console.log("[markAttendance] body:", req.body);
    console.log("[markAttendance] file:", req.file ? req.file.filename : "MISSING");
    console.log("[markAttendance] content-type:", req.headers["content-type"]);

    const teacher = await Teacher.findOne({ userId: req.user.id }).select("_id schoolId").lean();
    if (!teacher) return res.status(403).json({ message: "Teacher profile not found" });

    const schoolId = req.user.schoolId;
    const today = toMidnight(new Date());

    // 1. Duplicate check
    const existing = await TeacherAttendance.findOne({ teacherId: teacher._id, date: today });
    if (existing && existing.status === "P") {
      return res.status(409).json({ message: "Attendance already marked today" });
    }

    // 2. Require selfie
    if (!req.file) {
      return res.status(400).json({ message: "Selfie is required" });
    }

    // 3. Require location
    const latitude = parseFloat(req.body.latitude);
    const longitude = parseFloat(req.body.longitude);
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ message: "Valid GPS location is required" });
    }

    // 4. Geofence validation
    const school = await School.findById(schoolId).select("geofence name").lean();
    if (!school) return res.status(404).json({ message: "School not found" });

    let distanceFromSchool = null;
    if (school.geofence?.latitude != null && school.geofence?.longitude != null) {
      distanceFromSchool = Math.round(
        haversineMetres(latitude, longitude, school.geofence.latitude, school.geofence.longitude)
      );
      const radius = school.geofence.radiusMeters || 100;
      if (distanceFromSchool > radius) {
        return res.status(400).json({
          message: `You are outside the school location (${distanceFromSchool}m away, allowed radius ${radius}m)`,
          distanceFromSchool,
        });
      }
    }
    // If school has no geofence configured, allow without location check

    const selfieUrl = `/uploads/teacher-selfies/${req.file.filename}`;

    // 5. Upsert record (in case admin already created an A record for today)
    const record = await TeacherAttendance.findOneAndUpdate(
      { teacherId: teacher._id, date: today },
      {
        teacherId: teacher._id,
        schoolId,
        date: today,
        status: "P",
        checkInTime: new Date(),
        selfieUrl,
        location: { latitude, longitude },
        distanceFromSchool,
        markedBy: "self",
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ message: "Attendance marked successfully", data: record });
  } catch (err) {
    console.error("markAttendance error:", err);
    res.status(500).json({ message: "Error marking attendance" });
  }
};

// ── GET /api/teacher-attendance/today ────────────────────────────────────────
exports.getTodayStatus = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id }).select("_id").lean();
    if (!teacher) return res.status(403).json({ message: "Teacher profile not found" });

    const today = toMidnight(new Date());
    const record = await TeacherAttendance.findOne({
      teacherId: teacher._id,
      date: today,
    }).lean();

    res.json({ data: record || null });
  } catch (err) {
    console.error("getTodayStatus error:", err);
    res.status(500).json({ message: "Error fetching today's status" });
  }
};

// ── GET /api/teacher-attendance/my ───────────────────────────────────────────
// Query: ?month=YYYY-MM (optional)
exports.getMyAttendance = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id }).select("_id").lean();
    if (!teacher) return res.status(403).json({ message: "Teacher profile not found" });

    const filter = { teacherId: teacher._id };

    if (req.query.month) {
      const [y, m] = req.query.month.split("-").map(Number);
      if (y && m) {
        filter.date = {
          $gte: new Date(y, m - 1, 1),
          $lte: new Date(y, m, 0, 23, 59, 59),
        };
      }
    }

    const records = await TeacherAttendance.find(filter).sort({ date: -1 }).lean();
    res.json({ data: records });
  } catch (err) {
    console.error("getMyAttendance error:", err);
    res.status(500).json({ message: "Error fetching attendance" });
  }
};

// ── GET /api/teacher-attendance/admin ────────────────────────────────────────
// Query: ?date=YYYY-MM-DD  (defaults to today)
// Roles: school_admin, admin
exports.getAttendanceForAdmin = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    let targetDate;
    if (req.query.date) {
      const [y, m, d] = req.query.date.split("-").map(Number);
      targetDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      targetDate = toMidnight(new Date());
    }

    const startOfDay = new Date(targetDate);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all teachers for the school
    const teachers = await Teacher.find({ schoolId, status: "active" })
      .populate("userId", "name email")
      .lean();

    // Get all attendance records for that date
    const records = await TeacherAttendance.find({
      schoolId,
      date: { $gte: startOfDay, $lte: endOfDay },
    }).lean();

    const recordMap = new Map(records.map((r) => [r.teacherId.toString(), r]));

    // Approved leave overlapping this calendar day → show Leave (unless they checked in Present)
    const onLeaveTeacherIds = new Set();
    if (schoolId) {
      const approvedLeaves = await Leave.find({
        schoolId,
        status: "approved",
        startDate: { $lte: endOfDay },
        endDate: { $gte: startOfDay },
      })
        .select("teacherId")
        .lean();
      for (const lv of approvedLeaves) {
        onLeaveTeacherIds.add(lv.teacherId.toString());
      }
    }

    const data = teachers.map((t) => {
      const tid = t._id.toString();
      const record = recordMap.get(tid);
      const checkedInPresent = record?.status === "P";
      const onApprovedLeave = onLeaveTeacherIds.has(tid);

      let status = record?.status || "A";
      if (!checkedInPresent && onApprovedLeave) {
        status = "L";
      }

      return {
        teacherId: t._id,
        teacherName: t.userId?.name || "—",
        teacherEmail: t.userId?.email || "—",
        date: targetDate,
        status,
        checkInTime: record?.checkInTime || null,
        selfieUrl: record?.selfieUrl || null,
        location: record?.location || null,
        distanceFromSchool: record?.distanceFromSchool ?? null,
        markedBy: record?.markedBy || "auto",
      };
    });

    res.json({ data, date: req.query.date || new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error("getAttendanceForAdmin error:", err);
    res.status(500).json({ message: "Error fetching admin attendance" });
  }
};

// ── Internal: mark all unmarked teachers as Absent ───────────────────────────
// Called by cron job daily after school hours
exports.markAbsentAll = async (schoolId) => {
  try {
    const today = toMidnight(new Date());
    const startOfDay = new Date(today);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const filter = schoolId ? { schoolId, status: "active" } : { status: "active" };
    const teachers = await Teacher.find(filter).select("_id schoolId").lean();

    const teacherIds = teachers.map((t) => t._id);
    let onLeaveIds = new Set();
    if (teacherIds.length > 0) {
      const leaveRows = await Leave.find({
        teacherId: { $in: teacherIds },
        status: "approved",
        startDate: { $lte: endOfDay },
        endDate: { $gte: startOfDay },
      })
        .select("teacherId")
        .lean();
      onLeaveIds = new Set(leaveRows.map((l) => l.teacherId.toString()));
    }

    let count = 0;
    for (const t of teachers) {
      const existing = await TeacherAttendance.findOne({
        teacherId: t._id,
        date: { $gte: startOfDay, $lte: endOfDay },
      });
      if (existing) continue;

      if (onLeaveIds.has(t._id.toString())) {
        await TeacherAttendance.create({
          teacherId: t._id,
          schoolId: t.schoolId,
          date: today,
          status: "L",
          markedBy: "auto",
        });
        count++;
        continue;
      }

      await TeacherAttendance.create({
        teacherId: t._id,
        schoolId: t.schoolId,
        date: today,
        status: "A",
        markedBy: "auto",
      });
      count++;
    }
    console.log(`[Cron] Marked ${count} teacher(s) as Absent for ${today.toDateString()}`);
    return count;
  } catch (err) {
    console.error("[Cron] markAbsentAll error:", err);
  }
};

// ── PATCH /api/teacher-attendance/school-geofence ────────────────────────────
// School admin sets geofence for their school
exports.updateGeofence = async (req, res) => {
  try {
    const { latitude, longitude, radiusMeters } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: "latitude and longitude are required" });
    }
    const school = await School.findByIdAndUpdate(
      req.user.schoolId,
      { "geofence.latitude": latitude, "geofence.longitude": longitude, "geofence.radiusMeters": radiusMeters || 100 },
      { new: true }
    ).select("geofence name");
    res.json({ message: "Geofence updated", data: school });
  } catch (err) {
    console.error("updateGeofence error:", err);
    res.status(500).json({ message: "Error updating geofence" });
  }
};

// ── GET /api/teacher-attendance/school-geofence ──────────────────────────────
exports.getGeofence = async (req, res) => {
  try {
    const school = await School.findById(req.user.schoolId).select("geofence name").lean();
    res.json({ data: school?.geofence || null });
  } catch (err) {
    res.status(500).json({ message: "Error fetching geofence" });
  }
};
