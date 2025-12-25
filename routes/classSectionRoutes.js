// routes/classSectionRoutes.js
const router = require("express").Router();
const protect = require("../middleware/authMiddleware");
const {
  assignSection,
  deleteSection,
} = require("../controllers/classSectionController");

router.post("/", protect, assignSection);
router.delete("/:id", protect, deleteSection);

module.exports = router;
