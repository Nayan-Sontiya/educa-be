// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const School = require("../models/School");
const { schoolAccessMessage } = require("../utils/schoolAccessMessage");
const { resolveSchoolIdForUser } = require("../utils/resolveSchoolId");
const { isSchoolSubscriptionSuspended } = require("../utils/subscriptionAccess");

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
        return res.status(403).json({
          message: "Subscription expired. Please renew to continue.",
          code: "SUBSCRIPTION_SUSPENDED",
        });
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
