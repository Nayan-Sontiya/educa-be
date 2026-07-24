// controllers/authController.js
const User = require("../models/User");
const School = require("../models/School");
const College = require("../models/College");
const { schoolAccessMessage } = require("../utils/schoolAccessMessage");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { resolveSchoolIdForUser } = require("../utils/resolveSchoolId");
const {
  isSchoolSubscriptionSuspended,
  getSchoolBillingAccess,
} = require("../utils/subscriptionAccess");
const { normalizePhone } = require("../utils/phone");
const { normalizeUsername } = require("../utils/username");
const Teacher = require("../models/Teacher");
const { assertParentCanAuthenticate } = require("../utils/pendingStudentAccess");
const {
  assertEmailAvailable,
  findUserByEmail,
  normalizeEmail,
  EMAIL_IN_USE_MESSAGE,
} = require("../utils/emailUniqueness");

exports.registerUser = async (req, res) => {
  try {
    const { name, email, username, password, role, phone, schoolId } = req.body;
    
    if (role === "student") {
      const { dateOfBirth, city, state, emailVerificationToken, phoneVerificationToken } = req.body;
      
      // 1. Verify mandatory fields
      if (!name?.trim() || !email?.trim() || !phone || !password || !dateOfBirth || !city?.trim() || !state?.trim()) {
        return res.status(400).json({ success: false, message: "Please fill all required fields." });
      }

      // 2. Validate email format
      const { assertEmailAvailable, isValidEmailFormat } = require("../utils/emailUniqueness");
      if (!isValidEmailFormat(email)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address." });
      }

      // 3. Verify email uniqueness
      const emailCheck = await assertEmailAvailable(email);
      if (!emailCheck.ok) {
        if (emailCheck.status === 409) {
          return res.status(409).json({ success: false, message: "An account already exists with this email address." });
        }
        return res.status(emailCheck.status).json({ success: false, message: emailCheck.message });
      }

      // 4. Validate password strength
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character."
        });
      }

      // 5. Validate Date of Birth (cannot be in the future)
      const dobDate = new Date(dateOfBirth);
      if (isNaN(dobDate.getTime())) {
        return res.status(400).json({ success: false, message: "Please enter a valid Date of Birth." });
      }
      if (dobDate > new Date()) {
        return res.status(400).json({ success: false, message: "Date of birth cannot be in the future" });
      }

      // 6. Assert OTP tokens
      const { assertEmailVerificationToken } = require("../utils/emailVerificationJwt");
      const { assertPhoneVerificationToken } = require("./signupOtpController");

      const evCheck = assertEmailVerificationToken(emailVerificationToken, email);
      if (!evCheck.ok) {
        return res.status(400).json({ success: false, message: evCheck.message });
      }

      const pvCheck = assertPhoneVerificationToken(phoneVerificationToken, phone);
      if (!pvCheck.ok) {
        return res.status(400).json({ success: false, message: pvCheck.message });
      }

      // Hash password
      const hash = await bcrypt.hash(password, 10);

      // Create student user
      const userData = {
        name: name.trim(),
        email: emailCheck.normalizedEmail,
        password: hash,
        role: "student",
        phone: phone,
        dateOfBirth: dobDate,
        city: city.trim(),
        state: state.trim()
      };

      const pn = normalizePhone(phone);
      if (pn) userData.phoneNormalized = pn;

      const user = await User.create(userData);

      return res.status(201).json({
        success: true,
        message: "Student registered successfully.",
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          dateOfBirth: user.dateOfBirth,
          city: user.city,
          state: user.state,
          createdAt: user.createdAt
        }
      });
    }

    // Validation
    if (!name || !password || !role) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (role === "admin") {
      return res.status(403).json({
        message: "Platform admin accounts cannot be registered via signup",
      });
    }

    // For non-parent/student roles, email is required
    if (role !== "parent" && role !== "student" && !email) {
      return res.status(400).json({ message: "Email is required for this role" });
    }

    const normalizedUsername = username ? normalizeUsername(username) : "";
    // For parent/student roles, username is required
    if ((role === "parent" || role === "student") && !normalizedUsername) {
      return res.status(400).json({ message: "Username is required for this role" });
    }

    // Check if user already exists by email (if email provided)
    if (email) {
      const emailCheck = await assertEmailAvailable(email);
      if (!emailCheck.ok) {
        return res.status(emailCheck.status).json({ message: emailCheck.message });
      }
    }

    // Usernames are globally unique (all schools); compare canonical form
    if (normalizedUsername) {
      const existsByUsername = await User.findOne({ username: normalizedUsername });
      if (existsByUsername) {
        return res.status(409).json({ message: "A user with this username already exists" });
      }
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);
    
    // Create user
    const userData = {
      name,
      password: hash,
      role,
    };

    // Add email if provided (required for non-parent/student)
    if (email) userData.email = normalizeEmail(email);
    
    if (normalizedUsername) userData.username = normalizedUsername;

    // Add optional fields
    if (phone) {
      userData.phone = phone;
      const pn = normalizePhone(phone);
      if (pn) userData.phoneNormalized = pn;
    }
    if (schoolId) userData.schoolId = schoolId;

    const user = await User.create(userData);

    // Generate token
    const token = jwt.sign(
      { id: user._id, role: user.role, schoolId: user.schoolId },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Format user response (without password)
    const userResponse = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      username: user.username,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      schoolId: user.schoolId,
      createdAt: user.createdAt,
      role: user.role,
      isBlocked: user.isBlocked === true,
      isOnboarded: user.isOnboarded === true,
    };

    res.status(201).json({ 
      success: true,
      token, 
      user: userResponse 
    });
  } catch (error) {
    console.error("registerUser error:", error);
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const keyPattern = error.keyPattern || {};
      const keyValue = error.keyValue || {};
      
      if (keyPattern.email && keyValue.email) {
        return res.status(409).json({ message: EMAIL_IN_USE_MESSAGE });
      }
      
      if (keyPattern.username && keyValue.username) {
        return res.status(409).json({ 
          message: `Username "${keyValue.username}" is already taken. Please choose a different username.` 
        });
      }
      
      return res.status(409).json({ 
        message: "A user with this information already exists." 
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Validation error",
        errors: errors,
      });
    }
    
    res.status(500).json({ message: "Error registering user" });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // For backward compatibility, the frontend sends a single "email" field
    // which can contain either an email address (for teachers/admins)
    // or a username (for parents). We detect which one to use.
    if (!email || !password) {
      return res.status(400).json({ message: "Email/username and password are required" });
    }

    let user;
    if (email.includes("@")) {
      user = await findUserByEmail(email);
    } else {
      const un = normalizeUsername(email);
      user = un ? await User.findOne({ username: un }) : null;
    }

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

    if (user.isBlocked === true) {
      return res.status(403).json({ message: "Your account has been blocked" });
    }

    if (user.role === "parent") {
      const parentAccess = await assertParentCanAuthenticate(user._id);
      if (!parentAccess.allowed) {
        return res.status(403).json({
          message: parentAccess.message,
          code: parentAccess.code,
        });
      }
    }

    // 👇 Check teacher status if role is teacher
    if (user.role === "teacher") {
      const teacher = await Teacher.findOne({ userId: user._id });

      if (!teacher) {
        return res.status(403).json({ message: "Teacher profile not found" });
      }

      if (teacher.status !== "active") {
        return res.status(403).json({ message: "Your account is not active" });
      }
    }

    if (user.role === "school_admin" && user.schoolId) {
      const school = await School.findById(user.schoolId).select(
        "verificationStatus rejectionReason reviewNote name"
      );
      if (!school) {
        return res.status(403).json({ message: "School not found for this account" });
      }
      if (school.verificationStatus !== "Verified") {
        return res.status(403).json({
          message: schoolAccessMessage(school),
        });
      }
    }

    if (user.role === "college_admin") {
      const college = user.collegeId
        ? await College.findById(user.collegeId).select("verificationStatus rejectionReason name")
        : await College.findOne({ createdBy: user._id }).select("verificationStatus rejectionReason name");

      if (!college) {
        return res.status(403).json({ message: "College profile not found for this account" });
      }

      if (college.verificationStatus !== "Verified") {
        let msg = "Your college registration is currently under review. You will be notified once it is approved.";
        if (college.verificationStatus === "Rejected") {
          msg = "Your registration has been rejected. Please contact UtthanAI Support for more information.";
        } else if (college.verificationStatus === "Suspended") {
          msg = "Your college account has been suspended. Please contact UtthanAI Support.";
        } else if (college.verificationStatus === "Blocked") {
          msg = "Your college account has been blocked. Please contact UtthanAI Support.";
        }
        return res.status(403).json({ success: false, message: msg });
      }
    }

    if (user.role !== "admin") {
      const schoolId = await resolveSchoolIdForUser(user);
      if (
        schoolId &&
        (await isSchoolSubscriptionSuspended(schoolId)) &&
        user.role !== "school_admin"
      ) {
        return res.status(403).json({
          message: "Subscription expired. Please renew to continue.",
          code: "SUBSCRIPTION_SUSPENDED",
        });
      }
      if (schoolId) {
        const billing = await getSchoolBillingAccess(schoolId);
        if (!billing.allowed && user.role !== "school_admin") {
          return res.status(403).json({
            message: billing.message,
            code: billing.code,
          });
        }
      }
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, schoolId: user.schoolId },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Format user response (without password)
    const userResponse = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      username: user.username,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      schoolId: user.schoolId,
      createdAt: user.createdAt,
      role: user.role,
      isBlocked: user.isBlocked === true,
      isOnboarded: user.isOnboarded === true,
    };
    if (user.role === "teacher") {
      userResponse.teacherStatus = "active";
    }

    res.json({ 
      success: true,
      token, 
      user: userResponse 
    });
  } catch (error) {
    console.error("loginUser error:", error);
    res.status(500).json({ message: "Error logging in" });
  }
};

exports.logoutUser = async (req, res) => {
  try {
    // Since JWT is stateless, logout is primarily handled client-side
    // by removing the token. This endpoint exists for consistency
    // and potential future use (logging, token blacklisting, etc.)
    res.json({ 
      success: true,
      message: "Logged out successfully" 
    });
  } catch (error) {
    console.error("logoutUser error:", error);
    res.status(500).json({ message: "Error logging out" });
  }
};
