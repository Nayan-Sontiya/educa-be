// controllers/calendarController.js
const StudentCalendar = require("../models/StudentCalendar");
const SchoolCalendarEvent = require("../models/SchoolCalendarEvent");
const Student = require("../models/Student");
const Attendance = require("../models/Attendance");
const ClassSection = require("../models/ClassSection");

// Get student calendar (for parent/student view)
exports.getStudentCalendar = async (req, res) => {
  try {
    const { studentId, startDate, endDate } = req.query;

    if (!studentId) {
      return res.status(400).json({ message: "studentId is required" });
    }

    // Verify access: parent can only see their own child's calendar
    if (req.user.role === "parent") {
      const student = await Student.findById(studentId);
      if (!student || student.parentUserId.toString() !== req.user.id) {
        return res.status(403).json({
          message: "You are not allowed to view this student's calendar",
        });
      }
    }

    let calendar = await StudentCalendar.findOne({ studentId });

    if (!calendar) {
      calendar = await StudentCalendar.create({ studentId, entries: [] });
    }

    // Get school calendar events for this student's school
    const student = await Student.findById(studentId).populate("schoolId");
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    // Fetch school events that overlap with the date range
    const schoolEvents = await SchoolCalendarEvent.find({
      schoolId: student.schoolId._id,
      isActive: true,
      $or: [
        {
          appliesToAllClasses: true,
        },
        {
          classIds: student.classId,
        },
      ],
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start },
        },
      ],
    });

    // Sync school events to calendar
    for (const event of schoolEvents) {
      const eventDate = new Date(event.startDate);
      while (eventDate <= event.endDate && eventDate <= end) {
        if (eventDate >= start) {
          const dateStr = eventDate.toISOString().split("T")[0];
          const existingIndex = calendar.entries.findIndex(
            (entry) =>
              entry.type === "school_event" &&
              entry.eventId &&
              entry.eventId.toString() === event._id.toString() &&
              entry.date.toISOString().split("T")[0] === dateStr
          );

          const entry = {
            date: new Date(eventDate),
            type: "school_event",
            eventId: event._id,
            eventTitle: event.title,
            eventType: event.type,
          };

          if (existingIndex >= 0) {
            calendar.entries[existingIndex] = entry;
          } else {
            calendar.entries.push(entry);
          }
        }
        eventDate.setDate(eventDate.getDate() + 1);
      }
    }

    await calendar.save();

    // Filter entries by date range
    const filteredEntries = calendar.entries.filter((entry) => {
      const entryDate = new Date(entry.date);
      return entryDate >= start && entryDate <= end;
    });

    res.json({
      data: {
        studentId,
        entries: filteredEntries.sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        ),
      },
    });
  } catch (error) {
    console.error("getStudentCalendar error:", error);
    res.status(500).json({ message: "Error fetching student calendar" });
  }
};

// Get school calendar events (for admin/teacher)
exports.getSchoolCalendarEvents = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!req.user.schoolId) {
      return res.status(400).json({ message: "User must belong to a school" });
    }

    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const events = await SchoolCalendarEvent.find({
      schoolId: req.user.schoolId,
      isActive: true,
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start },
        },
      ],
    }).sort({ startDate: 1 });

    res.json({ data: events });
  } catch (error) {
    console.error("getSchoolCalendarEvents error:", error);
    res.status(500).json({ message: "Error fetching school calendar events" });
  }
};

// Create school calendar event (admin only)
exports.createSchoolCalendarEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      startDate,
      endDate,
      appliesToAllClasses,
      classIds,
    } = req.body;

    if (!title || !type || !startDate || !endDate) {
      return res.status(400).json({
        message: "title, type, startDate, and endDate are required",
      });
    }

    if (!["holiday", "event", "exam", "ptm"].includes(type)) {
      return res.status(400).json({ message: "Invalid event type" });
    }

    if (!req.user.schoolId) {
      return res.status(400).json({ message: "User must belong to a school" });
    }

    const event = await SchoolCalendarEvent.create({
      schoolId: req.user.schoolId,
      title,
      description: description || "",
      type,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      appliesToAllClasses: appliesToAllClasses !== false,
      classIds: appliesToAllClasses ? [] : classIds || [],
      createdBy: req.user.id,
    });

    // Sync to all student calendars in the school
    await syncSchoolEventToStudentCalendars(event);

    res.status(201).json({
      message: "School calendar event created successfully",
      data: event,
    });
  } catch (error) {
    console.error("createSchoolCalendarEvent error:", error);
    res.status(500).json({ message: "Error creating school calendar event" });
  }
};

// Update school calendar event (admin only)
exports.updateSchoolCalendarEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const event = await SchoolCalendarEvent.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      req.user.schoolId &&
      event.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res.status(403).json({
        message: "You are not allowed to update this event",
      });
    }

    Object.assign(event, updateData);
    if (updateData.startDate) event.startDate = new Date(updateData.startDate);
    if (updateData.endDate) event.endDate = new Date(updateData.endDate);

    await event.save();

    // Re-sync to student calendars
    await syncSchoolEventToStudentCalendars(event);

    res.json({
      message: "School calendar event updated successfully",
      data: event,
    });
  } catch (error) {
    console.error("updateSchoolCalendarEvent error:", error);
    res.status(500).json({ message: "Error updating school calendar event" });
  }
};

// Delete school calendar event (admin only)
exports.deleteSchoolCalendarEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await SchoolCalendarEvent.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      req.user.schoolId &&
      event.schoolId.toString() !== req.user.schoolId.toString()
    ) {
      return res.status(403).json({
        message: "You are not allowed to delete this event",
      });
    }

    // Remove from all student calendars
    await StudentCalendar.updateMany(
      {},
      {
        $pull: {
          entries: {
            type: "school_event",
            eventId: event._id,
          },
        },
      }
    );

    await SchoolCalendarEvent.findByIdAndDelete(id);

    res.json({ message: "School calendar event deleted successfully" });
  } catch (error) {
    console.error("deleteSchoolCalendarEvent error:", error);
    res.status(500).json({ message: "Error deleting school calendar event" });
  }
};

// Helper: Sync school event to all relevant student calendars
async function syncSchoolEventToStudentCalendars(event) {
  try {
    const query = { schoolId: event.schoolId };
    if (!event.appliesToAllClasses && event.classIds.length > 0) {
      query.classId = { $in: event.classIds };
    }

    const students = await Student.find(query).select("_id");

    for (const student of students) {
      let calendar = await StudentCalendar.findOne({ studentId: student._id });
      if (!calendar) {
        calendar = await StudentCalendar.create({
          studentId: student._id,
          entries: [],
        });
      }

      const eventDate = new Date(event.startDate);
      while (eventDate <= event.endDate) {
        const dateStr = eventDate.toISOString().split("T")[0];
        const existingIndex = calendar.entries.findIndex(
          (entry) =>
            entry.type === "school_event" &&
            entry.eventId &&
            entry.eventId.toString() === event._id.toString() &&
            entry.date.toISOString().split("T")[0] === dateStr
        );

        const entry = {
          date: new Date(eventDate),
          type: "school_event",
          eventId: event._id,
          eventTitle: event.title,
          eventType: event.type,
        };

        if (existingIndex >= 0) {
          calendar.entries[existingIndex] = entry;
        } else {
          calendar.entries.push(entry);
        }

        eventDate.setDate(eventDate.getDate() + 1);
      }

      await calendar.save();
    }
  } catch (error) {
    console.error("syncSchoolEventToStudentCalendars error:", error);
  }
}
