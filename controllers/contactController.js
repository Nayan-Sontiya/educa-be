const mongoose = require("mongoose");
const ContactMessage = require("../models/ContactMessage");
const { sendMail } = require("../utils/mail");

const DEFAULT_NOTIFY_EMAIL = "sontiya.nayan@gmail.com";

function webAppBase() {
  return (
    process.env.WEB_APP_URL ||
    process.env.EDUCA_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    process.env.APP_PUBLIC_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function notifyEmail() {
  const raw = process.env.CONTACT_ADMIN_EMAIL;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return DEFAULT_NOTIFY_EMAIL;
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /api/contacts — public
 */
exports.create = async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!name || name.length < 2) {
      return res.status(400).json({ message: "Please enter your name (at least 2 characters)." });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (!message || message.length < 10) {
      return res.status(400).json({ message: "Please enter a message (at least 10 characters)." });
    }

    const doc = await ContactMessage.create({ name, email, message });

    const to = notifyEmail();
    const dashboardUrl = `${webAppBase()}/dashboard/contacts`;
    const subject = `[UtthanAI] New contact message from ${name}`;
    const text =
      `Name: ${name}\n` +
      `Email: ${email}\n\n` +
      `Message:\n${message}\n\n` +
      `---\n` +
      `Open in admin: ${dashboardUrl}\n` +
      `Submission id: ${doc._id}`;

    const mailResult = await sendMail({
      to,
      subject,
      text,
      logContext: "contact_form",
    });
    if (mailResult?.error) {
      console.error("[contact] notify mail failed (message still saved)", {
        contactId: doc._id.toString(),
        notifyTo: to,
        errorMessage: mailResult.error.message,
        errorCode: mailResult.error.code,
        responseCode: mailResult.error.responseCode,
      });
    }

    return res.status(201).json({
      message: "Thanks — we received your message and will reply by email soon.",
      data: { id: doc._id.toString() },
    });
  } catch (err) {
    console.error("contact create:", err);
    return res.status(500).json({ message: err.message || "Could not send message" });
  }
};

function toRow(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    message: doc.message,
    status: doc.status,
    adminNotes: doc.adminNotes || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * GET /api/contacts/admin/all — admin
 */
exports.listAdmin = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [items, total] = await Promise.all([
      ContactMessage.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ContactMessage.countDocuments({}),
    ]);

    return res.json({
      data: items.map(toRow),
      total,
      limit,
      skip,
    });
  } catch (err) {
    console.error("contact listAdmin:", err);
    return res.status(500).json({ message: err.message || "Failed to load messages" });
  }
};

const ALLOWED_STATUS = ["new", "in_progress", "resolved"];

/**
 * PATCH /api/contacts/:id — admin
 */
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const status =
      typeof req.body?.status === "string" ? req.body.status.trim() : "";
    const adminNotes =
      typeof req.body?.adminNotes === "string" ? req.body.adminNotes.trim() : undefined;

    const update = {};
    if (status) {
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({
          message: `status must be one of: ${ALLOWED_STATUS.join(", ")}`,
        });
      }
      update.status = status;
    }
    if (adminNotes !== undefined) {
      if (adminNotes.length > 2000) {
        return res.status(400).json({ message: "adminNotes too long" });
      }
      update.adminNotes = adminNotes;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "Provide status and/or adminNotes" });
    }

    const doc = await ContactMessage.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) {
      return res.status(404).json({ message: "Message not found" });
    }

    return res.json({ data: toRow(doc) });
  } catch (err) {
    console.error("contact updateStatus:", err);
    return res.status(500).json({ message: err.message || "Update failed" });
  }
};
