const mongoose = require("mongoose");

const STATUS = ["new", "in_progress", "resolved"];

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    message: { type: String, required: true, trim: true, maxlength: 10000 },
    status: {
      type: String,
      enum: STATUS,
      default: "new",
    },
    adminNotes: { type: String, default: "", trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
