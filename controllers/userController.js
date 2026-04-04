// controllers/userController.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { normalizePhone } = require("../utils/phone");

const ROLE_ENUM = ["admin", "teacher", "counselor", "school_admin", "parent", "student"];

async function countActiveAdmins(excludeUserId) {
  const q = { role: "admin", isBlocked: { $ne: true } };
  if (excludeUserId) {
    q._id = { $ne: excludeUserId };
  }
  return User.countDocuments(q);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

const CONTACT_OTP_TTL_MS = 5 * 60 * 1000;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isOtpValid(block, otp) {
  if (!block || !block.code || !block.expiresAt) return false;
  if (new Date() > new Date(block.expiresAt)) return false;
  return String(block.code) === String(otp || "").trim();
}

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password")
      .populate("schoolId", "name");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user profile" });
  }
};

exports.updateCurrentUser = async (req, res) => {
  try {
    const {
      name,
      gender,
      dateOfBirth,
      address,
      phone,
      email,
    } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (gender !== undefined) updateData.gender = gender || undefined;
    if (dateOfBirth !== undefined) {
      if (dateOfBirth) {
        const dob = new Date(dateOfBirth);
        if (Number.isNaN(dob.getTime())) {
          return res.status(400).json({ message: "Invalid date of birth" });
        }
        if (dob > new Date()) {
          return res.status(400).json({ message: "Date of birth cannot be in the future" });
        }
        updateData.dateOfBirth = dob;
      } else {
        updateData.dateOfBirth = undefined;
      }
    }
    if (address !== undefined) updateData.address = address || undefined;

    const current = await User.findById(req.user.id);
    if (!current) {
      return res.status(404).json({ message: "User not found" });
    }

    if (phone !== undefined) {
      const nextPhone = String(phone || "").trim();
      const currentNormalized = normalizePhone(current.phone || "");
      const nextNormalized = normalizePhone(nextPhone);
      const isPhoneChanged = (currentNormalized || "") !== (nextNormalized || "");

      if (isPhoneChanged) {
        const pending = current.pendingContactChange?.phone;
        if (!pending?.verified || pending?.normalized !== nextNormalized) {
          return res.status(400).json({
            message:
              "Phone change requires OTP verification. Request and verify OTP first.",
          });
        }
      }
      updateData.phone = nextPhone || undefined;
    }

    if (email !== undefined) {
      const nextEmail = String(email || "").trim().toLowerCase();
      const currentEmail = String(current.email || "").trim().toLowerCase();
      const isEmailChanged = nextEmail !== currentEmail;

      if (nextEmail && !validateEmail(nextEmail)) {
        return res.status(400).json({ message: "Please provide a valid email" });
      }

      if (isEmailChanged) {
        const pending = current.pendingContactChange?.email;
        if (!pending?.verified || pending?.value !== nextEmail) {
          return res.status(400).json({
            message:
              "Email change requires OTP verification. Request and verify OTP first.",
          });
        }
      }
      updateData.email = nextEmail || undefined;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    )
      .select("-password")
      .populate("schoolId", "name");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (phone !== undefined || email !== undefined) {
      user.pendingContactChange = undefined;
      await user.save();
    }

    res.json({ message: "Profile updated successfully", user });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Error updating profile" });
  }
};

exports.requestContactChangeOtp = async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (email === undefined && phone === undefined) {
      return res.status(400).json({
        message: "Provide at least one field: email or phone",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const expiresAt = new Date(Date.now() + CONTACT_OTP_TTL_MS);
    const dev = process.env.NODE_ENV !== "production";
    const response = { message: "OTP sent for requested contact changes" };

    if (!user.pendingContactChange) {
      user.pendingContactChange = {};
    }

    if (email !== undefined) {
      const nextEmail = String(email || "").trim().toLowerCase();
      if (!nextEmail || !validateEmail(nextEmail)) {
        return res.status(400).json({ message: "Please provide a valid email" });
      }
      const exists = await User.findOne({ email: nextEmail, _id: { $ne: user._id } });
      if (exists) {
        return res.status(409).json({ message: "Email already in use" });
      }
      const code = generateCode();
      user.pendingContactChange.email = {
        value: nextEmail,
        code,
        expiresAt,
        verified: false,
      };
      if (dev) response.emailOtp = code;
    }

    if (phone !== undefined) {
      const nextPhone = String(phone || "").trim();
      const nextNormalized = normalizePhone(nextPhone);
      if (!nextPhone || !nextNormalized || nextNormalized.length < 8) {
        return res.status(400).json({ message: "Please provide a valid mobile number" });
      }
      const exists = await User.findOne({
        phoneNormalized: nextNormalized,
        _id: { $ne: user._id },
      });
      if (exists) {
        return res.status(409).json({ message: "Mobile number already in use" });
      }
      const code = generateCode();
      user.pendingContactChange.phone = {
        value: nextPhone,
        normalized: nextNormalized,
        code,
        expiresAt,
        verified: false,
      };
      if (dev) response.phoneOtp = code;
    }

    await user.save();
    return res.json(response);
  } catch (error) {
    console.error("requestContactChangeOtp:", error);
    return res.status(500).json({ message: "Could not send OTP" });
  }
};

exports.verifyContactChangeOtp = async (req, res) => {
  try {
    const { emailOtp, phoneOtp } = req.body;
    if (!emailOtp && !phoneOtp) {
      return res.status(400).json({
        message: "Provide at least one OTP: emailOtp or phoneOtp",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pending = user.pendingContactChange || {};
    if (emailOtp) {
      if (!isOtpValid(pending.email, emailOtp)) {
        return res.status(400).json({ message: "Invalid or expired email OTP" });
      }
      pending.email.verified = true;
      pending.email.code = undefined;
    }
    if (phoneOtp) {
      if (!isOtpValid(pending.phone, phoneOtp)) {
        return res.status(400).json({ message: "Invalid or expired mobile OTP" });
      }
      pending.phone.verified = true;
      pending.phone.code = undefined;
    }

    user.pendingContactChange = pending;
    await user.save();

    return res.json({
      message: "OTP verified successfully. You can now save contact changes.",
      verified: {
        email: !!pending.email?.verified,
        phone: !!pending.phone?.verified,
      },
    });
  } catch (error) {
    console.error("verifyContactChangeOtp:", error);
    return res.status(500).json({ message: "Could not verify OTP" });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
    const skip = (page - 1) * limit;

    const q = {};
    if (req.query.role && ROLE_ENUM.includes(req.query.role)) {
      q.role = req.query.role;
    }
    if (req.query.schoolId && isValidObjectId(req.query.schoolId)) {
      q.schoolId = req.query.schoolId;
    }
    if (req.query.blocked === "true") {
      q.isBlocked = true;
    } else if (req.query.blocked === "false") {
      q.isBlocked = { $in: [false, null] };
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ name: rx }, { email: rx }, { username: rx }, { phone: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(q)
        .select("-password")
        .populate("schoolId", "name verificationStatus")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(q),
    ]);

    res.status(200).json({
      success: true,
      data: users,
      count: users.length,
      total,
      page,
      limit,
      message: "Users retrieved successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching users" });
  }
};

exports.assignSchool = async (req, res) => {
  try {
    const { userId, schoolId } = req.body;
    const user = await User.findByIdAndUpdate(
      userId,
      { schoolId },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "School assigned successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Error assigning school" });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!ROLE_ENUM.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const err = await assertCanChangeAdminRole(target, role);
    if (err) {
      return res.status(400).json({ success: false, message: err });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    )
      .select("-password")
      .populate("schoolId", "name verificationStatus");
    res.status(200).json({
      success: true,
      data: user,
      message: "Role updated successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating role" });
  }
};

async function assertCanChangeAdminRole(targetUser, newRole) {
  if (targetUser.role !== "admin" || targetUser.isBlocked === true) {
    return null;
  }
  if (newRole === "admin") return null;
  const others = await countActiveAdmins(targetUser._id);
  if (others < 1) {
    return "Cannot change role of the last active platform admin";
  }
  return null;
}

async function assertCanStripAdminOrBlock(targetUser, patch) {
  if (targetUser.role !== "admin" || targetUser.isBlocked === true) {
    return null;
  }
  const becomesNonAdmin = patch.role && patch.role !== "admin";
  const becomesBlocked = patch.isBlocked === true;
  if (!becomesNonAdmin && !becomesBlocked) return null;
  const others = await countActiveAdmins(targetUser._id);
  if (others < 1) {
    return "Cannot remove or block the last active platform admin";
  }
  return null;
}

exports.getUserById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("schoolId", "name verificationStatus");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({
      success: true,
      data: user,
      message: "User retrieved successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
};

exports.adminPatchUser = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const {
      name,
      email,
      username,
      phone,
      role,
      schoolId,
      isBlocked,
    } = req.body;

    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (email !== undefined) {
      const e = String(email || "").trim().toLowerCase();
      if (e && !validateEmail(e)) {
        return res.status(400).json({ success: false, message: "Invalid email" });
      }
      patch.email = e || undefined;
    }
    if (username !== undefined) {
      const u = String(username || "").trim();
      patch.username = u || undefined;
    }
    if (phone !== undefined) {
      patch.phone = String(phone || "").trim() || undefined;
    }
    if (role !== undefined) {
      if (!ROLE_ENUM.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }
      patch.role = role;
    }
    if (schoolId !== undefined) {
      if (schoolId === null || schoolId === "") {
        patch.schoolId = undefined;
      } else if (!isValidObjectId(String(schoolId))) {
        return res.status(400).json({ success: false, message: "Invalid school id" });
      } else {
        patch.schoolId = schoolId;
      }
    }
    if (isBlocked !== undefined) {
      patch.isBlocked = Boolean(isBlocked);
    }

    const guard = await assertCanStripAdminOrBlock(target, patch);
    if (guard) {
      return res.status(400).json({ success: false, message: guard });
    }

    if (String(req.user.id) === String(target._id) && patch.isBlocked === true) {
      return res.status(400).json({ success: false, message: "You cannot block your own account" });
    }

    if (patch.email) {
      const taken = await User.findOne({
        email: patch.email,
        _id: { $ne: target._id },
      });
      if (taken) {
        return res.status(409).json({ success: false, message: "Email already in use" });
      }
    }
    if (patch.username) {
      const taken = await User.findOne({
        username: patch.username,
        _id: { $ne: target._id },
      });
      if (taken) {
        return res.status(409).json({ success: false, message: "Username already in use" });
      }
    }

    Object.assign(target, patch);
    if (target.isModified("phone")) {
      const n = normalizePhone(target.phone);
      target.phoneNormalized = n || undefined;
    }

    await target.save();
    const fresh = await User.findById(target._id)
      .select("-password")
      .populate("schoolId", "name verificationStatus");

    res.status(200).json({
      success: true,
      data: fresh,
      message: "User updated successfully",
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)
          .map((e) => e.message)
          .join(", "),
      });
    }
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate email or username",
      });
    }
    res.status(500).json({ success: false, message: "Error updating user" });
  }
};

exports.adminDeleteUser = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account" });
    }
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (target.role === "admin" && target.isBlocked !== true) {
      const others = await countActiveAdmins(target._id);
      if (others < 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the last active platform admin",
        });
      }
    }
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting user" });
  }
};

exports.adminResetPassword = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: "newPassword is required (min 6 characters)",
      });
    }
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    target.password = hash;
    target.authOtp = undefined;
    target.pendingPasswordChange = undefined;
    await target.save();
    res.status(200).json({
      success: true,
      message: "Password reset successfully. Ask the user to sign in with the new password.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error resetting password" });
  }
};
