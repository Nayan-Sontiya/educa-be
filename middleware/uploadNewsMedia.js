const multer = require("multer");

const fileFilter = (_req, file, cb) => {
  const ext = (file.originalname || "").toLowerCase();
  const imageExts = /\.(jpeg|jpg|png|gif|webp|bmp)$/;
  const videoExts = /\.(mp4|webm|mov|m4v)$/;
  const isImage =
    file.mimetype.startsWith("image/") || imageExts.test(ext);
  const isVideo =
    file.mimetype.startsWith("video/") || videoExts.test(ext);

  if (isImage || isVideo) {
    return cb(null, true);
  }
  cb(new Error("Only image (jpeg, png, gif, webp) or video (mp4, webm, mov) files are allowed"));
};

const uploadNewsMedia = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
  fileFilter,
});

module.exports = uploadNewsMedia;
