const path = require('path');

/**
 * Convert absolute file path to relative path for database storage
 * @param {string} absolutePath - Absolute file path (e.g., "C:\Users\...\uploads\file.png")
 * @returns {string} Relative path (e.g., "uploads/file.png")
 */
const getRelativePath = (absolutePath) => {
  if (!absolutePath) return null;
  
  // If already a relative path or URL, return as is
  if (absolutePath.startsWith('http://') || absolutePath.startsWith('https://')) {
    return absolutePath;
  }
  
  // If already relative (starts with 'uploads/'), return as is
  if (absolutePath.startsWith('uploads/') || absolutePath.startsWith('uploads\\')) {
    return absolutePath.replace(/\\/g, '/');
  }
  
  // Extract the relative path from absolute path
  // Find 'uploads' directory in the path and get everything after it
  const uploadsIndex = absolutePath.toLowerCase().indexOf('uploads');
  if (uploadsIndex !== -1) {
    const relativePath = absolutePath.substring(uploadsIndex);
    // Normalize path separators to forward slashes
    return relativePath.replace(/\\/g, '/');
  }
  
  // Fallback: just get the filename
  return `uploads/${path.basename(absolutePath)}`;
};

/**
 * Utility function to convert file paths to full URLs
 * @param {string} filePath - Relative file path (e.g., "uploads/filename.png")
 * @param {Object} req - Express request object (optional, for getting base URL)
 * @returns {string} Full URL to the file
 */
const getFileUrl = (filePath, req = null) => {
  if (!filePath) return null;
  
  // If already a full URL, return as is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  
  // Convert absolute paths to relative first
  let relativePath = filePath;
  if (path.isAbsolute(filePath)) {
    relativePath = getRelativePath(filePath);
  }
  
  // Get base URL from environment or request
  let baseUrl;
  if (req) {
    baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  } else {
    baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  }
  
  // Remove leading slash if present in filePath to avoid double slashes
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  
  return `${baseUrl}/${cleanPath}`;
};

/**
 * Convert an array of file paths to full URLs
 * @param {string[]} filePaths - Array of relative file paths
 * @param {Object} req - Express request object (optional)
 * @returns {string[]} Array of full URLs
 */
const getFileUrls = (filePaths, req = null) => {
  if (!Array.isArray(filePaths)) return [];
  return filePaths.map(path => getFileUrl(path, req)).filter(url => url !== null);
};

/**
 * Convert document object with file paths to URLs
 * @param {Object} documents - Object with file paths (e.g., { registrationCertificate: "uploads/file.pdf" })
 * @param {Object} req - Express request object (optional)
 * @returns {Object} Object with file URLs
 */
const convertDocumentsToUrls = (documents, req = null) => {
  if (!documents || typeof documents !== 'object') return {};
  
  const converted = {};
  Object.keys(documents).forEach(key => {
    converted[key] = getFileUrl(documents[key], req);
  });
  return converted;
};

module.exports = {
  getRelativePath,
  getFileUrl,
  getFileUrls,
  convertDocumentsToUrls,
};
