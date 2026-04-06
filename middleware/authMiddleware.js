// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const School = require("../models/School");
const { schoolAccessMessage } = require("../utils/schoolAccessMessage");
const { resolveSchoolIdForUser } = require("../utils/resolveSchoolId");
const {
  isSchoolSubscriptionSuspended,
  getSchoolBillingAccess,
} = require("../utils/subscriptionAccess");

/**
 * School admin can reach subscription checkout and minimal profile routes when access is blocked
 * (trial ended, payment failed / suspended, etc.).
 */
function schoolAdminSubscriptionRecoveryPaths(req, role) {
  if (role !== "school_admin") return false;
  const path = (req.originalUrl || req.url || "").split("?")[0];
  if (path.startsWith("/api/subscription/admin/")) return false;
  if (path.startsWith("/api/subscription/")) return true;
  if (path === "/api/users/me" || path.startsWith("/api/users/me/")) return true;
  if (path === "/api/schools/my-school") return true;
  return false;
}

/** Allow reading profile (schoolBilling) when billing blocks the rest of the API. GET only. */
function billingBlockProfileRead(req) {
  if (req.method !== "GET") return false;
  const path = (req.originalUrl || req.url || "").split("?")[0];
  return path === "/api/users/me" || path.startsWith("/api/users/me/");
}

function bypassesSchoolBillingBlock(req, role) {
  if (billingBlockProfileRead(req)) return true;
  if (role === "school_admin" && schoolAdminSubscriptionRecoveryPaths(req, role)) return true;
  return false;
}

const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (user.isBlocked === true) {
      return res.status(403).json({ message: "Your account has been blocked" });
    }

    if (user.role === "school_admin" && user.schoolId) {
      const school = await School.findById(user.schoolId).select(
        "verificationStatus rejectionReason reviewNote name"
      );
      if (!school) {
        return res.status(403).json({ message: "School not found for this account" });
      }
      if (school.verificationStatus !== "Verified") {
        return res.status(403).json({ message: schoolAccessMessage(school) });
      }
    }

    if (user.role !== "admin") {
      const schoolId = await resolveSchoolIdForUser(user);
      if (schoolId && (await isSchoolSubscriptionSuspended(schoolId))) {
        if (!bypassesSchoolBillingBlock(req, user.role)) {
          return res.status(403).json({
            message: "Subscription expired. Please renew to continue.",
            code: "SUBSCRIPTION_SUSPENDED",
          });
        }
      }
      if (schoolId) {
        const billing = await getSchoolBillingAccess(schoolId);
        if (!billing.allowed && !bypassesSchoolBillingBlock(req, user.role)) {
          return res.status(403).json({
            message: billing.message,
            code: billing.code,
          });
        }
      }
    }

    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.error("protect middleware:", err);
    return res.status(500).json({ message: "Authentication failed" });
  }
};

module.exports = protect;
