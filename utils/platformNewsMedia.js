const { getFileUrl, normalizeGalleryPath } = require("./fileUrlHelper");
const {
  buildCloudinaryUrl,
  extractPublicIdFromUrl,
  CLOUDINARY_PREFIX,
} = require("./cloudinary");

/** Normalize any client/legacy value to DB storage form (never a full http URL). */
function normalizeStoredMediaPath(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith(CLOUDINARY_PREFIX)) {
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const cloudinaryId = extractPublicIdFromUrl(trimmed);
    if (cloudinaryId) return `${CLOUDINARY_PREFIX}${cloudinaryId}`;
    const relative = normalizeGalleryPath(trimmed);
    if (relative && relative.startsWith("uploads/")) return relative;
    return "";
  }

  if (trimmed.startsWith("uploads/")) {
    return trimmed;
  }

  if (trimmed.includes("/")) {
    return `${CLOUDINARY_PREFIX}${trimmed}`;
  }

  return "";
}

function resolveMediaUrlForResponse(storedPath, req = null, mediaType = "image") {
  if (!storedPath) return "";
  const stored = normalizeStoredMediaPath(storedPath) || String(storedPath).trim();
  if (!stored) return "";

  if (stored.startsWith(CLOUDINARY_PREFIX)) {
    const publicId = stored.slice(CLOUDINARY_PREFIX.length);
    const resourceType = mediaType === "video" ? "video" : "image";
    return buildCloudinaryUrl(publicId, resourceType) || "";
  }

  if (stored.startsWith("uploads/")) {
    return getFileUrl(stored, req) || "";
  }

  return "";
}

function isValidStoredMediaPath(storedPath) {
  if (!storedPath) return false;
  return (
    storedPath.startsWith(CLOUDINARY_PREFIX) ||
    storedPath.startsWith("uploads/")
  );
}

module.exports = {
  CLOUDINARY_PREFIX,
  normalizeStoredMediaPath,
  resolveMediaUrlForResponse,
  isValidStoredMediaPath,
};
