// controllers/authController.js
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Teacher = require("../models/Teacher");

exports.registerUser = async (req, res) => {
  try {
    const { name, email, username, password, role, phone, schoolId } = req.body;
    
    // Validation
    if (!name || !password || !role) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // For non-parent/student roles, email is required
    if (role !== "parent" && role !== "student" && !email) {
      return res.status(400).json({ message: "Email is required for this role" });
    }

    // For parent/student roles, username is required
    if ((role === "parent" || role === "student") && !username) {
      return res.status(400).json({ message: "Username is required for this role" });
    }

    // Check if user already exists by email (if email provided)
    if (email) {
      const existsByEmail = await User.findOne({ email });
      if (existsByEmail) {
        return res.status(409).json({ message: "A user with this email already exists" });
      }
    }

    // Check if user already exists by username (if username provided)
    if (username) {
      const existsByUsername = await User.findOne({ username });
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
    if (email) userData.email = email;
    
    // Add username if provided (required for parent/student)
    if (username) userData.username = username;

    // Add optional fields
    if (phone) userData.phone = phone;
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
      phone: user.phone,
      role: user.role,
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
        return res.status(409).json({ 
          message: `Email "${keyValue.email}" is already registered. Please use a different email.` 
        });
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
      user = await User.findOne({ email });
    } else {
      user = await User.findOne({ username: email });
    }

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

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
      role: user.role,
    };

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
