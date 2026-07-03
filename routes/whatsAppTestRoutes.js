const express = require("express");
const router = express.Router();
const { testSendWhatsAppMessage } = require("../controllers/whatsAppTestController");

// Temporary POST endpoint to test WhatsApp API integration
router.post("/send", testSendWhatsAppMessage);

module.exports = router;
