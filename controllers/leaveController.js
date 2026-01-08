const Leave = require("../models/Leave");
const Teacher = require("../models/Teacher");
const School = require("../models/School");

// Apply for leave (Teacher)
exports.applyLeave = async (req, res) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const { schoolId } = req.user;

    // Validation
    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!["paid", "unpaid"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Leave type must be 'paid' or 'unpaid'",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: "End date must be on or after start date",
      });
    }

    // Compare dates only (ignore time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDateOnly = new Date(start);
    startDateOnly.setHours(0, 0, 0, 0);
    
    if (startDateOnly < today) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be in the past",
      });
    }

    // Calculate days (excluding Sundays)
    const calculateDaysExcludingSundays = (startDate, endDate) => {
      let count = 0;
      const current = new Date(startDate);
      const end = new Date(endDate);
      while (current <= end) {
        if (current.getDay() !== 0) { // Not Sunday (0 = Sunday)
          count++;
        }
        current.setDate(current.getDate() + 1);
      }
      return count;
    };
    
    const days = calculateDaysExcludingSundays(start, end);

    // Find teacher
    const teacher = await Teacher.findOne({
      userId: req.user.id,
      schoolId,
      status: "active",
    });

    if (!teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher not found or not active",
      });
    }

    // If paid leave, check remaining quota
    if (type === "paid") {
      const school = await School.findById(schoolId);
      if (!school) {
        return res.status(404).json({
          success: false,
          message: "School not found",
        });
      }

      // Get approved paid leaves for current year
      const currentYear = new Date().getFullYear();
      const yearStart = new Date(currentYear, 0, 1);
      const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

      const approvedPaidLeaves = await Leave.find({
        teacherId: teacher._id,
        schoolId,
        type: "paid",
        status: "approved",
        startDate: { $gte: yearStart, $lte: yearEnd },
      });

      const usedPaidLeaves = approvedPaidLeaves.reduce(
        (sum, leave) => sum + leave.days,
        0
      );

      const remainingPaidLeaves = (school.paidLeaveCount || 0) - usedPaidLeaves;

      if (days > remainingPaidLeaves) {
        return res.status(400).json({
          success: false,
          message: `Insufficient paid leave balance. Remaining: ${remainingPaidLeaves} days, Requested: ${days} days`,
        });
      }
    }

    // Create leave request
    const leave = await Leave.create({
      teacherId: teacher._id,
      schoolId,
      type,
      startDate: start,
      endDate: end,
      days,
      reason,
      status: "pending",
    });

    // Populate teacher info
    await leave.populate({
      path: "teacherId",
      populate: { path: "userId", select: "name email" },
    });

    res.status(201).json({
      success: true,
      data: leave,
      message: "Leave application submitted successfully",
    });
  } catch (error) {
    console.error("Error applying leave:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to apply for leave",
    });
  }
};

// Get teacher's leaves
exports.getMyLeaves = async (req, res) => {
  try {
    const { schoolId } = req.user;

    // Find teacher
    const teacher = await Teacher.findOne({
      userId: req.user.id,
      schoolId,
      status: "active",
    });

    if (!teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher not found or not active",
      });
    }

    const leaves = await Leave.find({
      teacherId: teacher._id,
      schoolId,
    })
      .sort({ startDate: -1 })
      .populate({
        path: "teacherId",
        populate: { path: "userId", select: "name email" },
      });

    res.status(200).json({
      success: true,
      data: leaves,
      total: leaves.length,
    });
  } catch (error) {
    console.error("Error fetching leaves:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch leaves",
    });
  }
};

// Get pending leaves for admin
exports.getPendingLeaves = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const leaves = await Leave.find({
      schoolId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "teacherId",
        populate: { path: "userId", select: "name email" },
      });

    res.status(200).json({
      success: true,
      data: leaves,
      total: leaves.length,
    });
  } catch (error) {
    console.error("Error fetching pending leaves:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch pending leaves",
    });
  }
};

// Get all leaves for admin (with filters)
exports.getAllLeaves = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status, type, teacherId } = req.query;

    const filter = { schoolId };

    if (status) filter.status = status;
    if (type) filter.type = type;
    if (teacherId) filter.teacherId = teacherId;

    const leaves = await Leave.find(filter)
      .sort({ startDate: -1 })
      .populate({
        path: "teacherId",
        populate: { path: "userId", select: "name email" },
      })
      .populate("approvedBy", "name email");

    res.status(200).json({
      success: true,
      data: leaves,
      total: leaves.length,
    });
  } catch (error) {
    console.error("Error fetching leaves:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch leaves",
    });
  }
};

// Approve leave
exports.approveLeave = async (req, res) => {
  try {
    const { leaveId } = req.params;
    const { schoolId, id: userId } = req.user;

    const leave = await Leave.findOne({
      _id: leaveId,
      schoolId,
      status: "pending",
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found or already processed",
      });
    }

    // If paid leave, double-check quota
    if (leave.type === "paid") {
      const school = await School.findById(schoolId);
      const currentYear = new Date().getFullYear();
      const yearStart = new Date(currentYear, 0, 1);
      const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

      const approvedPaidLeaves = await Leave.find({
        teacherId: leave.teacherId,
        schoolId,
        type: "paid",
        status: "approved",
        startDate: { $gte: yearStart, $lte: yearEnd },
        _id: { $ne: leave._id }, // Exclude current leave
      });

      const usedPaidLeaves = approvedPaidLeaves.reduce(
        (sum, l) => sum + l.days,
        0
      );

      const remainingPaidLeaves = (school.paidLeaveCount || 0) - usedPaidLeaves;

      if (leave.days > remainingPaidLeaves) {
        return res.status(400).json({
          success: false,
          message: `Cannot approve: Insufficient paid leave balance. Remaining: ${remainingPaidLeaves} days`,
        });
      }
    }

    leave.status = "approved";
    leave.approvedBy = userId;
    leave.approvedAt = new Date();
    await leave.save();

    await leave.populate({
      path: "teacherId",
      populate: { path: "userId", select: "name email" },
    });

    res.status(200).json({
      success: true,
      data: leave,
      message: "Leave approved successfully",
    });
  } catch (error) {
    console.error("Error approving leave:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to approve leave",
    });
  }
};

// Reject leave
exports.rejectLeave = async (req, res) => {
  try {
    const { leaveId } = req.params;
    const { rejectionReason } = req.body;
    const { schoolId, id: userId } = req.user;

    const leave = await Leave.findOne({
      _id: leaveId,
      schoolId,
      status: "pending",
    });

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found or already processed",
      });
    }

    leave.status = "rejected";
    leave.approvedBy = userId;
    leave.approvedAt = new Date();
    if (rejectionReason) {
      leave.rejectionReason = rejectionReason;
    }
    await leave.save();

    await leave.populate({
      path: "teacherId",
      populate: { path: "userId", select: "name email" },
    });

    res.status(200).json({
      success: true,
      data: leave,
      message: "Leave rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting leave:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to reject leave",
    });
  }
};

// Get teacher's leave statistics
exports.getLeaveStats = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const teacher = await Teacher.findOne({
      userId: req.user.id,
      schoolId,
      status: "active",
    });

    if (!teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher not found or not active",
      });
    }

    const school = await School.findById(schoolId);
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

    // Get paid leave stats
    const approvedPaidLeaves = await Leave.find({
      teacherId: teacher._id,
      schoolId,
      type: "paid",
      status: "approved",
      startDate: { $gte: yearStart, $lte: yearEnd },
    });

    const usedPaidLeaves = approvedPaidLeaves.reduce(
      (sum, leave) => sum + leave.days,
      0
    );

    const totalPaidLeaves = school.paidLeaveCount || 0;
    const remainingPaidLeaves = totalPaidLeaves - usedPaidLeaves;

    // Get all leaves count
    const totalLeaves = await Leave.countDocuments({
      teacherId: teacher._id,
      schoolId,
    });

    const pendingLeaves = await Leave.countDocuments({
      teacherId: teacher._id,
      schoolId,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      data: {
        paidLeaves: {
          total: totalPaidLeaves,
          used: usedPaidLeaves,
          remaining: remainingPaidLeaves,
        },
        totalLeaves,
        pendingLeaves,
      },
    });
  } catch (error) {
    console.error("Error fetching leave stats:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch leave statistics",
    });
  }
};

