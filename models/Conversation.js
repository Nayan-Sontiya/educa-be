// models/Conversation.js
// Parent–teacher conversation about a student (one thread per parent–teacher–student)
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    parentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    teacherUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ parentUserId: 1, teacherUserId: 1, studentId: 1 }, { unique: true });
conversationSchema.index({ teacherUserId: 1, lastMessageAt: -1 });
conversationSchema.index({ parentUserId: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
