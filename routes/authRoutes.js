// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { registerUser, loginUser, logoutUser } = require("../controllers/authController");

// Register endpoints - both /register and /signup for compatibility
router.post("/register", registerUser);
router.post("/signup", registerUser); // Alias for register (used by frontend)

router.post("/login", loginUser);
router.post("/logout", logoutUser);

module.exports = router;
