const mongoose = require("mongoose");
const PlatformNews = require("../models/PlatformNews");
const {
  uploadBuffer,
  CLOUDINARY_PREFIX,
} = require("../utils/cloudinary");
const {
  normalizeStoredMediaPath,
  resolveMediaUrlForResponse,
  isValidStoredMediaPath,
} = require("../utils/platformNewsMedia");

const CAPTION_MAX_LENGTH = 2000;

function validateCaption(caption) {
  const trimmed = String(caption ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "Caption is required" };
  }
  if (trimmed.length > CAPTION_MAX_LENGTH) {
    return {
      ok: false,
      message: `Caption must be ${CAPTION_MAX_LENGTH} characters or fewer (you entered ${trimmed.length}).`,
    };
  }
  return { ok: true, value: trimmed };
}

function handleWriteError(res, err, fallback) {
  if (err.name === "ValidationError") {
    const captionErr = err.errors?.caption;
    if (captionErr?.kind === "maxlength") {
      return res.status(400).json({
        message: `Caption must be ${CAPTION_MAX_LENGTH} characters or fewer.`,
      });
    }
    const first = err.errors ? Object.values(err.errors)[0] : null;
    return res.status(400).json({
      message: first?.message || err.message || fallback,
    });
  }
  console.error(fallback, err);
  return res.status(500).json({ message: err.message || fallback });
}

function resolveMediaType(mimeType, filename) {
  if (mimeType && mimeType.startsWith("video/")) return "video";
  if (mimeType && mimeType.startsWith("image/")) return "image";
  const ext = String(filename || "").toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(ext)) return "video";
  if (/\.(jpe?g|png|gif|webp|bmp)$/.test(ext)) return "image";
  return "none";
}

function toPublicDoc(doc, req = null) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const mediaPath = normalizeStoredMediaPath(o.mediaUrl) || "";
  return {
    id: String(o._id),
    caption: o.caption,
    mediaType: o.mediaType || "none",
    mediaPath,
    mediaUrl: resolveMediaUrlForResponse(o.mediaUrl, req),
    authorName: o.authorName || "UtthanAI",
    publishedAt: o.publishedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function validateStoredMedia(storedPath, res) {
  if (!storedPath) {
    res.status(400).json({
      message: "Upload a photo or video using the Upload button before saving",
    });
    return false;
  }
  if (!isValidStoredMediaPath(storedPath)) {
    res.status(400).json({
      message:
        "Invalid media reference. Upload the file again — do not paste a URL.",
    });
    return false;
  }
  if (!storedPath.startsWith(CLOUDINARY_PREFIX)) {
    res.status(400).json({
      message:
        "Media must be uploaded again (legacy file links are not supported).",
    });
    return false;
  }
  return true;
}

/** GET /api/platform-news */
exports.listPublished = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { published: true };
    const [items, total] = await Promise.all([
      PlatformNews.find(filter)
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PlatformNews.countDocuments(filter),
    ]);

    return res.json({
      data: items.map((o) => toPublicDoc(o, req)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("platformNews listPublished:", err);
    return res.status(500).json({ message: err.message || "Failed to list news" });
  }
};

/** GET /api/platform-news/:id */
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const doc = await PlatformNews.findOne({ _id: id, published: true }).lean();
    if (!doc) return res.status(404).json({ message: "News not found" });

    return res.json({ data: toPublicDoc(doc, req) });
  } catch (err) {
    console.error("platformNews getById:", err);
    return res.status(500).json({ message: err.message || "Failed to load news" });
  }
};

/** GET /api/platform-news/admin/all */
exports.listAllAdmin = async (req, res) => {
  try {
    const items = await PlatformNews.find({})
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean();

    return res.json({
      data: items.map((o) => ({
        ...toPublicDoc(o, req),
        published: o.published,
      })),
    });
  } catch (err) {
    console.error("platformNews listAllAdmin:", err);
    return res.status(500).json({ message: err.message || "Failed to list news" });
  }
};

/** POST /api/platform-news */
exports.create = async (req, res) => {
  try {
    const { caption, mediaType, mediaUrl, published, authorName } = req.body;

    const captionCheck = validateCaption(caption);
    if (!captionCheck.ok) {
      return res.status(400).json({ message: captionCheck.message });
    }

    const type = ["none", "image", "video"].includes(mediaType)
      ? mediaType
      : "none";
    const storedPath =
      type === "none" ? "" : normalizeStoredMediaPath(mediaUrl);

    if (type !== "none" && !validateStoredMedia(storedPath, res)) {
      return;
    }
    if (type === "none" && storedPath) {
      return res.status(400).json({ message: "Remove media for caption-only posts" });
    }

    const pub = published !== false;
    const doc = await PlatformNews.create({
      caption: captionCheck.value,
      mediaType: type,
      mediaUrl: storedPath,
      published: pub,
      publishedAt: pub ? new Date() : null,
      createdBy: req.user?.id || null,
      authorName:
        typeof authorName === "string" && authorName.trim()
          ? authorName.trim()
          : "UtthanAI",
    });

    return res.status(201).json({ data: toPublicDoc(doc, req) });
  } catch (err) {
    return handleWriteError(res, err, "Create failed");
  }
};

/** PUT /api/platform-news/:id */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const doc = await PlatformNews.findById(id);
    if (!doc) return res.status(404).json({ message: "News not found" });

    const { caption, mediaType, mediaUrl, published, authorName } = req.body;

    if (caption != null) {
      const captionCheck = validateCaption(caption);
      if (!captionCheck.ok) {
        return res.status(400).json({ message: captionCheck.message });
      }
      doc.caption = captionCheck.value;
    }
    if (authorName != null) doc.authorName = String(authorName).trim() || "UtthanAI";

    if (mediaType != null) {
      if (!["none", "image", "video"].includes(mediaType)) {
        return res.status(400).json({ message: "Invalid media type" });
      }
      doc.mediaType = mediaType;
    }
    if (mediaUrl != null) {
      const storedPath = normalizeStoredMediaPath(mediaUrl);
      if (doc.mediaType !== "none" && !validateStoredMedia(storedPath, res)) {
        return;
      }
      doc.mediaUrl = storedPath;
    }

    if (doc.mediaType !== "none" && !doc.mediaUrl) {
      return res.status(400).json({ message: "Media URL is required for image/video posts" });
    }
    if (doc.mediaType === "none") doc.mediaUrl = "";

    if (published !== undefined) {
      const pub = Boolean(published);
      if (pub && !doc.published) doc.publishedAt = new Date();
      if (!pub) doc.publishedAt = null;
      doc.published = pub;
    }

    await doc.save();
    return res.json({ data: toPublicDoc(doc, req) });
  } catch (err) {
    return handleWriteError(res, err, "Update failed");
  }
};

/** DELETE /api/platform-news/:id */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const r = await PlatformNews.deleteOne({ _id: id });
    if (r.deletedCount === 0) return res.status(404).json({ message: "News not found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("platformNews remove:", err);
    return res.status(500).json({ message: err.message || "Delete failed" });
  }
};

/** POST /api/platform-news/upload — multer file on req.file */
exports.uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res.status(503).json({
        message: "Media upload is not configured (Cloudinary env missing)",
      });
    }

    const mediaType = resolveMediaType(req.file.mimetype, req.file.originalname);
    const result = await uploadBuffer(req.file.buffer, {
      folder: "educa/platform-news",
      resource_type: "auto",
      original_filename: req.file.originalname,
    });

    const mediaPath = `${CLOUDINARY_PREFIX}${result.public_id}`;

    return res.status(200).json({
      data: {
        mediaPath,
        mediaUrl: result.secure_url,
        mediaType,
        fileName: req.file.originalname,
        fileSize: req.file.size,
      },
      message: "File uploaded successfully",
    });
  } catch (err) {
    console.error("platformNews uploadMedia:", err);
    return res.status(500).json({ message: err.message || "Upload failed" });
  }
};
