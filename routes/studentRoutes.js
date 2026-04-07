const express = require("express");
const multer = require("multer");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  addStudentToClass,
  suggestUsernames,
  lookupLinkableStudents,
  linkExistingStudentToClass,
  getStudentsForClassSection,
  getStudentsForTeacher,
  getStudentsBySchool,
  updateStudent,
  deleteStudent,
  getStudentPortfolio,
  addAcademicRecord,
  addBehaviorRecord,
  addSkillRecord,
  addWellbeingRecord,
  getAIAnalysis,
  getMyChildren,
} = require("../controllers/studentController");

// Multer: memory storage for Cloudinary upload (max 5 files, 10 MB each)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only image and PDF files are allowed"), false);
    }
  },
});

// ─── Username suggestions ──────────────────────────────────────────────────────
router.post("/suggest-username", protect, roleCheck(["teacher", "school_admin"]), suggestUsernames);

// ─── Link flow ────────────────────────────────────────────────────────────────
router.post("/link/lookup", protect, roleCheck(["teacher", "school_admin"]), lookupLinkableStudents);
router.post("/link", protect, roleCheck(["teacher", "school_admin"]), linkExistingStudentToClass);

// ─── Student CRUD ─────────────────────────────────────────────────────────────
router.post("/", protect, roleCheck(["teacher", "school_admin"]), addStudentToClass);
router.get("/by-school", protect, roleCheck(["school_admin"]), getStudentsBySchool);
router.get("/for-teacher", protect, roleCheck(["teacher"]), getStudentsForTeacher);
router.get("/", protect, roleCheck(["teacher", "school_admin"]), getStudentsForClassSection);
router.put("/:id", protect, roleCheck(["teacher", "school_admin"]), updateStudent);
router.delete("/:id", protect, roleCheck(["teacher", "school_admin"]), deleteStudent);

// ─── Portfolio ────────────────────────────────────────────────────────────────
router.get(
  "/:id/portfolio",
  protect,
  roleCheck(["teacher", "school_admin", "parent"]),
  getStudentPortfolio
);

// Academic — JSON body is parsed by global express.json (30mb). Multipart uses multer only.
function academicMultipartIfNeeded(req, res, next) {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    return upload.array("evidenceFiles", 5)(req, res, next);
  }
  return next();
}

router.post(
  "/:id/portfolio/academic",
  protect,
  roleCheck(["teacher", "school_admin"]),
  academicMultipartIfNeeded,
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

router.post(
  "/:id/portfolio/wellbeing",
  protect,
  roleCheck(["teacher", "school_admin"]),
  addWellbeingRecord
);

// AI Analysis
router.get(
  "/:id/portfolio/analysis",
  protect,
  roleCheck(["teacher", "school_admin", "parent"]),
  getAIAnalysis
);

// ─── Parent ───────────────────────────────────────────────────────────────────
router.get("/my-children", protect, roleCheck(["parent"]), getMyChildren);

module.exports = router;
