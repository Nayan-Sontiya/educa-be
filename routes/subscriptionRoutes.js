const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const subscriptionController = require("../controllers/subscriptionController");
const subscriptionAdminController = require("../controllers/subscriptionAdminController");

router.post(
  "/checkout",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.createCheckoutSession
);

router.post(
  "/confirm-session",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.confirmCheckoutSession
);

router.get(
  "/status",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.getSubscriptionStatus
);

router.get(
  "/catalog",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.getSubscriptionCatalog
);

router.post(
  "/sync-student-count",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.syncStudentCountToStripe
);

router.get(
  "/admin/settings",
  protect,
  roleCheck(["admin"]),
  subscriptionAdminController.getBillingSettings
);

router.patch(
  "/admin/settings",
  protect,
  roleCheck(["admin"]),
  subscriptionAdminController.patchBillingSettings
);

router.get(
  "/admin/schools",
  protect,
  roleCheck(["admin"]),
  subscriptionAdminController.listSchoolSubscriptions
);

router.patch(
  "/admin/schools/:schoolId",
  protect,
  roleCheck(["admin"]),
  subscriptionAdminController.patchSchoolSubscription
);

module.exports = router;
