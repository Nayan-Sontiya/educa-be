const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const uploadNewsMedia = require("../middleware/uploadNewsMedia");
const platformNews = require("../controllers/platformNewsController");

router.get("/", platformNews.listPublished);
router.get("/admin/all", protect, roleCheck(["admin"]), platformNews.listAllAdmin);
router.post(
  "/upload",
  protect,
  roleCheck(["admin"]),
  uploadNewsMedia.single("file"),
  platformNews.uploadMedia
);
router.post("/", protect, roleCheck(["admin"]), platformNews.create);
router.get("/:id", platformNews.getById);
router.put("/:id", protect, roleCheck(["admin"]), platformNews.update);
router.delete("/:id", protect, roleCheck(["admin"]), platformNews.remove);

module.exports = router;
