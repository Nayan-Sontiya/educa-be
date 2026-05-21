const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const subscriptionController = require("../controllers/subscriptionController");
const subscriptionAdminController = require("../controllers/subscriptionAdminController");

/** Public: Razorpay catalog for marketing / pricing section (no auth). */
router.get(
  "/public-catalog",
  subscriptionController.getPublicSubscriptionCatalog
);

router.post(
  "/checkout",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.createCheckoutSession
);

router.post(
  "/verify-payment",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.verifyPayment
);

router.post(
  "/sync-from-razorpay",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.syncSubscriptionFromRazorpay
);

router.post(
  "/confirm-session",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.confirmCheckoutSession
);

router.post(
  "/verify-pending-payment",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.verifyPendingStudentsPayment
);

router.post(
  "/cancel",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.cancelSchoolSubscription
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

router.get(
  "/pending-students-activation-quote",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.getPendingStudentsActivationQuote
);

router.post(
  "/sync-student-count",
  protect,
  roleCheck(["school_admin"]),
  subscriptionController.syncStudentCount
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
