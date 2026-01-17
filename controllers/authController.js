// controllers/authController.js
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Teacher = require("../models/Teacher");

exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, schoolId } = req.body;
    
    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if user already exists
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);
    
    // Create user
    const userData = {
      name,
      email,
      password: hash,
      role,
    };

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
    res.status(500).json({ message: "Error registering user" });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
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
