// middleware/roleMiddleware.js
const roleCheck = (allowedRoles) => {
  return (req, res, next) => {
    console.log("Allowed Roles:", req.user.role);
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
};

module.exports = roleCheck;
