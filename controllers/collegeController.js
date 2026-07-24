// controllers/collegeController.js
const College = require("../models/College");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { findUserByEmail, normalizeEmail } = require("../utils/emailUniqueness");
const { notifyCollegeRegistered, notifyCollegeStatusChanged } = require("../utils/collegeEmailNotifications");

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).trim());
}

function validatePasswordStrength(pw) {
  if (!pw || typeof pw !== "string") return "Password is required";
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one number";
  if (!/[@$!%*?&#]/.test(pw)) return "Password must contain at least one special character";
  return null;
}

exports.registerCollege = async (req, res) => {
  try {
    const {
      collegeName,
      representativeName,
      designation,
      officialEmail,
      mobile,
      password,
      confirmPassword,
      city,
      state,
      acceptTerms,
    } = req.body || {};

    // 1. Mandatory Fields Check
    if (
      !collegeName ||
      !representativeName ||
      !designation ||
      !officialEmail ||
      !mobile ||
      !password ||
      !confirmPassword ||
      !city ||
      !state ||
      acceptTerms !== true
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields.",
      });
    }

    // 2. College Name Length Check
    if (String(collegeName).trim().length > 150) {
      return res.status(400).json({
        success: false,
        message: "College name cannot exceed 150 characters.",
      });
    }

    // 3. Email Format Check
    if (!validateEmail(officialEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    // 4. Password Mismatch Check
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match.",
      });
    }

    // 5. Password Complexity Check
    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) {
      return res.status(400).json({
        success: false,
        message: pwdErr,
      });
    }

    // 6. Duplicate Email Check
    const normEmail = normalizeEmail(officialEmail);
    const existingCollege = await College.findOne({ officialEmail: normEmail });
    const existingUser = await findUserByEmail(normEmail);

    if (existingCollege || existingUser) {
      return res.status(409).json({
        success: false,
        message: "A college account already exists with this email address.",
      });
    }

    // 7. Hash Password & Create User & College
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: representativeName.trim(),
      email: normEmail,
      password: passwordHash,
      role: "college_admin",
      phone: String(mobile).trim(),
      city: String(city).trim(),
      state: String(state).trim(),
      isOnboarded: false,
    });

    const college = await College.create({
      name: String(collegeName).trim(),
      officialEmail: normEmail,
      phone: String(mobile).trim(),
      city: String(city).trim(),
      state: String(state).trim(),
      representative: {
        name: String(representativeName).trim(),
        designation: String(designation).trim(),
      },
      verificationStatus: "Pending",
      createdBy: user._id,
    });

    // Link collegeId to user record
    user.collegeId = college._id;
    await user.save();

    // 8. Trigger Notification
    notifyCollegeRegistered({
      college,
      representativeName: representativeName.trim(),
    }).catch((err) => {
      console.error("notifyCollegeRegistered error:", err.message);
    });

    return res.status(201).json({
      success: true,
      data: {
        collegeId: college._id,
        collegeName: college.name,
        verificationStatus: college.verificationStatus,
      },
      message: "College registered successfully. Account is pending approval by UtthanAI.",
    });
  } catch (error) {
    console.error("registerCollege error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error occurred while registering college.",
    });
  }
};

/** Super Admin: Get all registered colleges */
exports.getAllColleges = async (req, res) => {
  try {
    const { status, search } = req.query || {};
    const query = {};

    if (status && status !== "All") {
      query.verificationStatus = status;
    }

    if (search) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ name: regex }, { officialEmail: regex }, { city: regex }, { state: regex }];
    }

    const colleges = await College.find(query)
      .populate("createdBy", "name email phone role")
      .sort({ createdAt: -1 });

    const total = await College.countDocuments({});
    const pending = await College.countDocuments({ verificationStatus: "Pending" });
    const verified = await College.countDocuments({ verificationStatus: "Verified" });
    const rejected = await College.countDocuments({ verificationStatus: "Rejected" });
    const suspended = await College.countDocuments({ verificationStatus: "Suspended" });

    return res.status(200).json({
      success: true,
      data: colleges,
      counts: { total, pending, verified, rejected, suspended },
      message: "Colleges fetched successfully",
    });
  } catch (error) {
    console.error("getAllColleges error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error occurred while fetching colleges.",
    });
  }
};

/** Super Admin / College Admin: Get single college details */
exports.getCollegeById = async (req, res) => {
  try {
    const { id } = req.params;
    const college = await College.findById(id).populate("createdBy", "name email phone role");

    if (!college) {
      return res.status(404).json({ success: false, message: "College not found" });
    }

    return res.status(200).json({
      success: true,
      data: college,
      message: "College details fetched successfully",
    });
  } catch (error) {
    console.error("getCollegeById error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error occurred while fetching college details.",
    });
  }
};

/** Super Admin: Update college verification status (Approve, Reject, Suspend, Reactivate) */
exports.updateCollegeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, reviewNote } = req.body || {};

    const validStatuses = ["Pending", "Verified", "Rejected", "Suspended", "Blocked"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification status provided.",
      });
    }

    const college = await College.findById(id);
    if (!college) {
      return res.status(404).json({ success: false, message: "College not found" });
    }

    const oldStatus = college.verificationStatus;
    college.verificationStatus = status;

    if (rejectionReason !== undefined) college.rejectionReason = rejectionReason;
    if (reviewNote !== undefined) college.reviewNote = reviewNote;

    await college.save();

    // Trigger status change notification email if status actually changed
    if (oldStatus !== status) {
      notifyCollegeStatusChanged({
        college,
        newStatus: status,
        reason: rejectionReason,
      }).catch((err) => {
        console.error("notifyCollegeStatusChanged error:", err.message);
      });
    }

    return res.status(200).json({
      success: true,
      data: college,
      message: `College status updated to ${status} successfully.`,
    });
  } catch (error) {
    console.error("updateCollegeStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error occurred while updating college status.",
    });
  }
};

/** College Admin: Get profile for logged in college representative */
exports.getCollegeMe = async (req, res) => {
  try {
    const userId = req.user?._id;
    const college = await College.findOne({ createdBy: userId }).populate("createdBy", "name email phone role");

    if (!college) {
      return res.status(404).json({ success: false, message: "College profile not found" });
    }

    return res.status(200).json({
      success: true,
      data: college,
      message: "College profile fetched successfully",
    });
  } catch (error) {
    console.error("getCollegeMe error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error occurred while fetching college profile.",
    });
  }
};
