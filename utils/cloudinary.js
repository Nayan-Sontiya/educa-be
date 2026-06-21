const cloudinary = require("cloudinary").v2;
const { Readable } = require("stream");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a buffer to Cloudinary and return the result.
 * @param {Buffer} buffer - file buffer from multer
 * @param {object} options - cloudinary upload options (folder, resource_type, etc.)
 * @returns {Promise<object>} cloudinary upload result
 */
const uploadBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "educa/evidence", resource_type: "auto", ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

/**
 * Delete a file from Cloudinary by public_id.
 */
const deleteFile = (publicId, resourceType = "image") =>
  cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

/** Build a HTTPS URL for a stored Cloudinary public_id. */
const buildCloudinaryUrl = (publicId, resourceType = "auto") =>
  cloudinary.url(publicId, { secure: true, resource_type: resourceType });

/** Extract public_id from a Cloudinary delivery URL. */
const extractPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return null;
    let i = uploadIdx + 1;
    // Skip version segment (v1234567890)
    if (parts[i] && /^v\d+$/.test(parts[i])) i += 1;
    const publicIdParts = parts.slice(i);
    if (!publicIdParts.length) return null;
    const last = publicIdParts[publicIdParts.length - 1];
    const dot = last.lastIndexOf(".");
    if (dot > 0) {
      publicIdParts[publicIdParts.length - 1] = last.slice(0, dot);
    }
    return publicIdParts.join("/");
  } catch {
    return null;
  }
};

const CLOUDINARY_PREFIX = "cloudinary:";

module.exports = {
  cloudinary,
  uploadBuffer,
  deleteFile,
  buildCloudinaryUrl,
  extractPublicIdFromUrl,
  CLOUDINARY_PREFIX,
};
