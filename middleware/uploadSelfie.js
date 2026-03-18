// middleware/uploadSelfie.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const selfieDir = path.join(__dirname, "../uploads/teacher-selfies");
if (!fs.existsSync(selfieDir)) fs.mkdirSync(selfieDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, selfieDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `selfie-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
};

const uploadSelfie = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

module.exports = uploadSelfie;
