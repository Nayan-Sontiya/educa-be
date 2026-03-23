// controllers/userController.js
const User = require("../models/User");
const { normalizePhone } = require("../utils/phone");

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
    const users = await User.find().populate("schoolId", "name");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
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
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Role updated successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Error updating role" });
  }
};
