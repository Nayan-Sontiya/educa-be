// routes/conversationRoutes.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  createConversationAndMessage,
  listConversations,
  listBySchool,
  getConversation,
  getMessages,
  sendMessage,
  markResolved,
  reopenConversation,
} = require("../controllers/conversationController");

// All routes require auth
router.use(protect);

// School admin: list conversations for school (audit)
router.get(
  "/by-school",
  roleCheck(["school_admin", "admin"]),
  listBySchool
);

// Parent: start conversation and send first message
router.post(
  "/",
  roleCheck(["parent"]),
  createConversationAndMessage
);

// Parent & Teacher: list my conversations
router.get(
  "/",
  roleCheck(["parent", "teacher"]),
  listConversations
);

// Get one conversation (participant only)
router.get(
  "/:id",
  roleCheck(["parent", "teacher"]),
  getConversation
);

// Get messages in conversation (paginated)
router.get(
  "/:id/messages",
  roleCheck(["parent", "teacher"]),
  getMessages
);

// Send message in conversation
router.post(
  "/:id/messages",
  roleCheck(["parent", "teacher"]),
  sendMessage
);

// Teacher: mark as resolved
router.patch(
  "/:id/resolved",
  roleCheck(["teacher"]),
  markResolved
);

// Reopen conversation
router.patch(
  "/:id/reopen",
  roleCheck(["parent", "teacher"]),
  reopenConversation
);

module.exports = router;
