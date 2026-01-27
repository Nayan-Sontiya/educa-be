const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  addStudentToClass,
  getStudentsForClassSection,
  updateStudent,
  deleteStudent,
  getStudentPortfolio,
  addAcademicRecord,
  addBehaviorRecord,
  addSkillRecord,
  getMyChildren,
} = require("../controllers/studentController");

// Teacher: add a student to a class section and create parent login
router.post(
  "/",
  protect,
  roleCheck(["teacher", "school_admin"]),
  addStudentToClass
);

// Teacher: get students for a class section
router.get(
  "/",
  protect,
  roleCheck(["teacher", "school_admin"]),
  getStudentsForClassSection
);

// Teacher: update a student
router.put(
  "/:id",
  protect,
  roleCheck(["teacher", "school_admin"]),
  updateStudent
);

// Teacher: delete a student
router.delete(
  "/:id",
  protect,
  roleCheck(["teacher", "school_admin"]),
  deleteStudent
);

// Portfolio endpoints
router.get(
  "/:id/portfolio",
  protect,
  roleCheck(["teacher", "school_admin", "parent"]),
  getStudentPortfolio
);

router.post(
  "/:id/portfolio/academic",
  protect,
  roleCheck(["teacher", "school_admin"]),
  addAcademicRecord
);

router.post(
  "/:id/portfolio/behavior",
  protect,
  roleCheck(["teacher", "school_admin"]),
  addBehaviorRecord
);

router.post(
  "/:id/portfolio/skills",
  protect,
  roleCheck(["teacher", "school_admin"]),
  addSkillRecord
);

// Parent: list their own children
router.get(
  "/my-children",
  protect,
  roleCheck(["parent"]),
  getMyChildren
);

module.exports = router;

