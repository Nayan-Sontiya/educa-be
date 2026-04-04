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
const deleteFile = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: "image" });

module.exports = { cloudinary, uploadBuffer, deleteFile };
