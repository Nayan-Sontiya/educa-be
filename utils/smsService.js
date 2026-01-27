// utils/smsService.js
// SMS helper using Fast2SMS API.
// Requires FAST2SMS_API_KEY in environment variables.

const https = require("https");

const FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2";

exports.sendSms = async (phone, message) => {
  if (!phone || !message) {
    console.warn("smsService.sendSms called without phone or message");
    return;
  }

  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.warn("FAST2SMS_API_KEY is not set. Skipping SMS send.");
    return;
  }

  // Fast2SMS expects an array of numbers, message, language, and route.
  const payload = JSON.stringify({
    route: "q", // generic transactional route; adjust in dashboard if needed
    message,
    numbers: Array.isArray(phone) ? phone.join(",") : String(phone),
  });

  const options = {
    method: "POST",
    headers: {
      authorization: apiKey,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };
  await new Promise((resolve) => {
    const req = https.request(FAST2SMS_URL, options, (res) => {
      let data = "";
    
      res.on("data", (chunk) => {
        data += chunk;
      });
    
      res.on("end", () => {
        console.log("Fast2SMS response:", data);
        resolve();
      });
    });

    req.on("error", (err) => {
      console.error("SMS send error (Fast2SMS):", err.message);
      resolve();
    });

    req.write(payload);
    req.end();
  });
};

