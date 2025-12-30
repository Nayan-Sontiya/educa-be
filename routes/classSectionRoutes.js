// routes/classSectionRoutes.js
const router = require("express").Router();
const protect = require("../middleware/authMiddleware");
const {
  assignSection,
  deleteSection,
  getClassWithSections,
} = require("../controllers/classSectionController");
const roleCheck = require("../middleware/roleMiddleware");
const auth = () => roleCheck(["admin", "school_admin"]);

router.post("/", protect, assignSection);
router.delete("/:id", protect, deleteSection);
router.get("/", protect, auth(), getClassWithSections);

module.exports = router;
