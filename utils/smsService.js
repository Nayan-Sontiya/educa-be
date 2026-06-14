/**
 * Fast2SMS — DLT transactional SMS only (parent login credentials).
 * Phone OTP is handled by Firebase on the client; backend verifies Firebase ID tokens.
 *
 * @see https://docs.fast2sms.com/reference/dlt-sms.md
 */

const https = require("https");

const FAST2SMS_HOST = "www.fast2sms.com";

function normalize10(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function fast2smsPost(path, payload) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.warn("[sms] FAST2SMS_API_KEY is not set — SMS skipped");
    return Promise.resolve({ ok: false, skipped: true, reason: "no_api_key" });
  }

  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: FAST2SMS_HOST,
        path,
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }
          const ok = parsed?.return === true || parsed?.status_code === 200;
          console.log("[sms] Fast2SMS response:", data);
          if (!ok) {
            console.error("[sms] Fast2SMS failed:", parsed?.message || data);
          }
          resolve({ ok, data: parsed });
        });
      },
    );
    req.on("error", (err) => {
      console.error("[sms] HTTP error:", err.message);
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

async function sendDltSms(phone, messageId, variablesValues) {
  const mobile = normalize10(phone);
  const senderId = process.env.FAST2SMS_DLT_SENDER_ID;

  if (!mobile || !senderId || !messageId) {
    console.error("[sms] DLT SMS missing mobile, sender ID, or template ID");
    return { ok: false, reason: "dlt_config" };
  }

  const vars = Array.isArray(variablesValues)
    ? variablesValues.map((v) => String(v ?? "").trim()).join("|")
    : String(variablesValues ?? "");

  return fast2smsPost("/dev/bulkV2", {
    route: "dlt",
    sender_id: senderId,
    message: String(messageId),
    variables_values: vars,
    numbers: mobile,
    sms_details: "1",
  });
}

async function sendParentCredentialsSms(
  phone,
  { schoolName, studentName, classSectionLabel, username, password },
) {
  const templateId = process.env.FAST2SMS_DLT_PARENT_CREDS_TEMPLATE_ID;
  if (!templateId) {
    console.error(
      "[sms] FAST2SMS_DLT_PARENT_CREDS_TEMPLATE_ID required for parent credential SMS",
    );
    return { ok: false, reason: "missing_parent_template_id" };
  }

  const {
    buildParentCredentialsDltVariables,
  } = require("./parentCredentialsSms");

  return sendDltSms(
    phone,
    templateId,
    buildParentCredentialsDltVariables({
      schoolName,
      studentName,
      classSectionLabel,
      username,
      password,
    }),
  );
}

module.exports = {
  sendDltSms,
  sendParentCredentialsSms,
  normalize10,
};
