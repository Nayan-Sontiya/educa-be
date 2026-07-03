/**
 * Meta WhatsApp Cloud API Service
 * 
 * Provides utility functions to normalize phone numbers, send generic 
 * template messages, and send student activation template messages.
 */

/**
 * Normalizes phone numbers to standard WhatsApp format (digits only, no + prefix).
 * If the input is a 10-digit number, it assumes it is an Indian mobile number and prepends '91'.
 * If the input is 11 digits and starts with '0', it strips the leading '0' and prepends '91'.
 * 
 * @param {string} phone - Raw input phone number
 * @returns {string} Normalized digits-only phone number
 */
function normalizeWhatsAppPhone(phone) {
  if (!phone) return "";
  
  // Strip all non-digit characters
  const digits = String(phone).replace(/\D/g, "");
  
  // If it's a 10-digit number, prepend India's country code 91
  if (digits.length === 10) {
    return "91" + digits;
  }
  
  // If it's 11 digits and starts with 0, strip the 0 and prepend 91
  if (digits.length === 11 && digits.startsWith("0")) {
    return "91" + digits.slice(1);
  }
  
  return digits;
}

/**
 * Helper to mask a phone number for safe logging (e.g. 91******3456)
 * @param {string} phone 
 * @returns {string} Masked phone number
 */
function maskPhone(phone) {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized || normalized.length < 4) return "******";
  return `${normalized.slice(0, 2)}******${normalized.slice(-4)}`;
}

/**
 * Sends a WhatsApp template message using Meta Cloud API.
 * 
 * @param {string} to - Recipient phone number
 * @param {string} templateName - Approved template name
 * @param {string} [languageCode='en'] - Language code of the template
 * @param {Array} [components=[]] - Template components (header, body, button parameters)
 * @returns {Promise<{ ok: boolean, status: number, data?: Object, error?: Object }>} Result status
 */
async function sendTemplateMessage(to, templateName, languageCode = "en", components = []) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v20.0";
  const maskedPhone = maskPhone(to);

  if (!token || !phoneNumberId) {
    console.warn("[whatsapp] Meta WhatsApp API skipped: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables");
    return {
      ok: false,
      status: 503,
      error: {
        message: "WhatsApp service is not configured (missing credentials)."
      }
    };
  }

  const normalizedTo = normalizeWhatsAppPhone(to);
  if (!normalizedTo) {
    console.warn("[whatsapp] Meta WhatsApp API skipped: invalid phone number", { to: maskedPhone });
    return {
      ok: false,
      status: 400,
      error: {
        message: "Invalid phone number."
      }
    };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: components
    }
  };

  try {
    console.info("[whatsapp] Sending template message request", {
      to: maskedPhone,
      template: templateName,
      languageCode
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const status = response.status;
    const data = await response.json();

    if (!response.ok) {
      console.error("[whatsapp] Meta API request failed", {
        to: maskedPhone,
        template: templateName,
        status,
        error: data.error
      });
      return {
        ok: false,
        status,
        error: data.error || { message: "Unknown API error from Meta" }
      };
    }

    console.info("[whatsapp] Template message sent successfully", {
      to: maskedPhone,
      template: templateName,
      messageId: data.messages?.[0]?.id
    });

    return {
      ok: true,
      status,
      data
    };
  } catch (error) {
    console.error("[whatsapp] Service execution error:", error.message || error);
    return {
      ok: false,
      status: 500,
      error: {
        message: error.message || "Internal server error in WhatsApp service"
      }
    };
  }
}

/**
 * Sends a student activation notification using the approved template 'add_student'.
 * The template contains:
 * - Body variable: Student Name
 * - Dynamic URL button variable: Activation Token
 * 
 * @param {string} to - Recipient phone number (e.g. Parent phone number)
 * @param {string} studentName - Name of the student
 * @param {string} activationToken - Activation token parameter to append to the template's button URL
 * @param {string} [languageCode='en_US'] - Language code (defaults to 'en_US')
 * @returns {Promise<{ ok: boolean, status: number, data?: Object, error?: Object }>}
 */
async function sendStudentActivationMessage(to, studentName, activationToken, languageCode = "en_US") {
  const components = [
    {
      type: "body",
      parameters: [
        {
          type: "text",
          text: studentName
        }
      ]
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [
        {
          type: "text",
          text: activationToken.startsWith("/") ? activationToken : `/${activationToken}`
        }
      ]
    }
  ];

  return sendTemplateMessage(to, "add_student", languageCode, components);
}


module.exports = {
  normalizeWhatsAppPhone,
  sendTemplateMessage,
  sendStudentActivationMessage
};
