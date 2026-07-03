const whatsAppService = require("../services/whatsAppService");

/**
 * Temporary testing controller endpoint to verify WhatsApp API functionality.
 * 
 * POST /api/test/whatsapp/send
 * Body parameters:
 * - phone (string, required): Phone number of recipient
 * - studentName (string, optional): Name of student (defaults to 'Test Student')
 * - activationToken (string, optional): Activation token (defaults to 'dummy-token-123')
 */
async function testSendWhatsAppMessage(req, res) {
  try {
    const { phone, studentName, activationToken, languageCode } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameter: phone"
      });
    }

    const name = studentName || "Test Student";
    const token = activationToken || "dummy-token-123";
    const lang = languageCode || "en_US";

    console.info("[whatsapp-test] Triggering test WhatsApp message", {
      phone,
      studentName: name,
      activationToken: token,
      languageCode: lang
    });

    const result = await whatsAppService.sendStudentActivationMessage(phone, name, token, lang);


    if (!result.ok) {
      return res.status(result.status || 500).json({
        success: false,
        message: "Failed to send WhatsApp message",
        error: result.error
      });
    }

    return res.status(200).json({
      success: true,
      message: "WhatsApp message triggered successfully",
      data: result.data
    });
  } catch (error) {
    console.error("[whatsapp-test] Controller error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error in test controller",
      error: { message: error.message || String(error) }
    });
  }
}

module.exports = {
  testSendWhatsAppMessage
};
