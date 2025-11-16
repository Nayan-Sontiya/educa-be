const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  registerTeacher,
  getAllTeachers,
  updateTeacherStatus,
  getMyProfile,
  updateMyProfile,
  deleteTeacher,
  addTeacherBySchoolAdmin,
  updateTeacher,
} = require("../controllers/teacherController");

// Public: Teacher self-register
router.post("/register", registerTeacher);

// School Admin adds a teacher
router.post(
  "/add",
  protect,
  roleCheck(["school_admin", "admin"]),
  addTeacherBySchoolAdmin
);

// Protected routes
router.get("/", protect, roleCheck(["admin", "school_admin"]), getAllTeachers);
router.patch(
  "/:id/status",
  protect,
  roleCheck(["admin", "school_admin"]),
  updateTeacherStatus
);

router.put(
  "/:id",
  protect,
  roleCheck(["admin", "school_admin"]),
  updateTeacher
);

router.get("/me", protect, roleCheck(["teacher"]), getMyProfile);
router.put(
  "/me",
  protect,
  roleCheck(["teacher", "school_admin"]),
  updateMyProfile
);
router.delete("/:id", protect, roleCheck(["admin"]), deleteTeacher);

module.exports = router;
