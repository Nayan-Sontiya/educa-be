const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const blog = require("../controllers/blogController");

router.get("/", blog.listPublished);
router.get("/slug/:slug", blog.getBySlug);

router.get("/admin/all", protect, roleCheck(["admin"]), blog.listAllAdmin);
router.post("/", protect, roleCheck(["admin"]), blog.create);
router.put("/:id", protect, roleCheck(["admin"]), blog.update);
router.delete("/:id", protect, roleCheck(["admin"]), blog.remove);

module.exports = router;
