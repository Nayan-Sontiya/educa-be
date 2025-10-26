// routes/schoolRoutes.js
const express = require("express");
const router = express.Router();
const {
  registerSchool,
  getSchools,
} = require("../controllers/schoolController");
const protect = require("../middleware/authMiddleware");

router.post("/register", protect, registerSchool); // only logged-in user can register a school
router.get("/", getSchools); // public route for listing schools

module.exports = router;
