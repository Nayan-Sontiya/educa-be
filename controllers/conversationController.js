// controllers/conversationController.js
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const TeacherAssignment = require("../models/TeacherAssignment");

// Get the class teacher's User id for a student.
// Prefer explicit class_teacher; if none, use any active teacher assigned to that class section
// (e.g. when the teacher who added the student is assigned as subject_teacher only).
async function getClassTeacherUserIdForStudent(student) {
  const studentId = student._id || student;
  const s = await Student.findById(studentId).select("classSectionId schoolId").lean();
  if (!s || !s.classSectionId) return null;
  let assignment = await TeacherAssignment.findOne({
    classSectionId: s.classSectionId,
    schoolId: s.schoolId,
    role: "class_teacher",
    status: "active",
  })
    .select("teacherId")
    .lean();
  if (!assignment) {
    assignment = await TeacherAssignment.findOne({
      classSectionId: s.classSectionId,
      schoolId: s.schoolId,
      status: "active",
    })
      .select("teacherId")
      .sort({ role: 1 })
      .lean();
  }
  if (!assignment) return null;
  const teacher = await Teacher.findById(assignment.teacherId).select("userId").lean();
  return teacher?.userId || null;
}

// Parent: start conversation and send first message (or get existing and send)
// Body: { studentId, content, isUrgent? }
exports.createConversationAndMessage = async (req, res) => {
  try {
    const parentUserId = req.user.id;
    if (req.user.role !== "parent") {
      return res.status(403).json({ message: "Only parents can start a conversation" });
    }
    const { studentId, content, isUrgent } = req.body;
    if (!studentId || !content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ message: "studentId and content are required" });
    }

    const student = await Student.findOne({
      _id: studentId,
      parentUserId,
      status: "active",
    })
      .populate("schoolId", "name")
      .populate("classId", "name");
    if (!student) {
      return res.status(403).json({ message: "Student not found or you are not the parent" });
    }

    const teacherUserId = await getClassTeacherUserIdForStudent(student);
    if (!teacherUserId) {
      return res.status(400).json({
        message: "No class teacher assigned for this student. Please contact the school.",
      });
    }

    let conversation = await Conversation.findOne({
      parentUserId,
      teacherUserId,
      studentId: student._id,
    })
      .populate("studentId", "name")
      .populate("parentUserId", "name")
      .populate("teacherUserId", "name");

    if (!conversation) {
      conversation = await Conversation.create({
        parentUserId,
        teacherUserId,
        studentId: student._id,
        schoolId: student.schoolId,
      });
      conversation = await Conversation.findById(conversation._id)
        .populate("studentId", "name")
        .populate("parentUserId", "name")
        .populate("teacherUserId", "name");
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: parentUserId,
      content: content.trim(),
      isUrgent: !!isUrgent,
    });
    conversation.lastMessageAt = new Date();
    conversation.status = "open";
    await conversation.save();

    const msgObj = message.toObject();
    msgObj.sender = { _id: req.user.id, name: req.user.name || "" };

    res.status(201).json({
      message: "Message sent",
      data: {
        conversation: {
          _id: conversation._id,
          parentUserId: conversation.parentUserId,
          teacherUserId: conversation.teacherUserId,
          studentId: conversation.studentId,
          schoolId: conversation.schoolId,
          status: conversation.status,
          lastMessageAt: conversation.lastMessageAt,
          student: conversation.studentId,
          parent: conversation.parentUserId,
          teacher: conversation.teacherUserId,
        },
        message: msgObj,
      },
    });
  } catch (error) {
    console.error("createConversationAndMessage error:", error);
    res.status(500).json({ message: "Error sending message" });
  }
};

// List conversations for current user (parent or teacher)
exports.listConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    let filter;
    if (role === "parent") {
      filter = { parentUserId: userId };
    } else if (role === "teacher") {
      filter = { teacherUserId: userId };
    } else {
      return res.status(403).json({ message: "Only parents and teachers can list conversations" });
    }

    const conversations = await Conversation.find(filter)
      .populate({
        path: "studentId",
        select: "name classId sectionId",
        populate: [
          { path: "classId", select: "name" },
          { path: "sectionId", select: "name" },
        ],
      })
      .populate("parentUserId", "name")
      .populate("teacherUserId", "name")
      .populate("schoolId", "name")
      .sort({ lastMessageAt: -1 })
      .lean();

    // Last message preview per conversation
    const convIds = conversations.map((c) => c._id);
    const lastMessages = await Message.aggregate([
      { $match: { conversationId: { $in: convIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$conversationId", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);
    const lastByConv = new Map(lastMessages.map((m) => [m.conversationId.toString(), m]));

    const data = conversations.map((c) => {
      const last = lastByConv.get(c._id.toString());
      const student = c.studentId;
      const className = student?.classId?.name || "";
      const sectionName = student?.sectionId?.name || "";
      return {
        _id: c._id,
        student: {
          _id: student?._id,
          name: student?.name,
          className,
          sectionName,
        },
        parent: c.parentUserId,
        teacher: c.teacherUserId,
        school: c.schoolId,
        status: c.status,
        lastMessageAt: c.lastMessageAt,
        lastMessage: last
          ? {
              content: last.content,
              isUrgent: last.isUrgent,
              senderId: last.senderId,
              createdAt: last.createdAt,
            }
          : null,
      };
    });

    res.json({ data });
  } catch (error) {
    console.error("listConversations error:", error);
    res.status(500).json({ message: "Error fetching conversations" });
  }
};

// Get one conversation (must be participant)
async function ensureCanAccessConversation(req, conversationId) {
  const conv = await Conversation.findById(conversationId)
    .populate("studentId", "name")
    .populate("parentUserId", "name")
    .populate("teacherUserId", "name")
    .populate("schoolId", "name");
  if (!conv) return { error: { status: 404, message: "Conversation not found" } };
  const userId = req.user.id;
  const isParent = conv.parentUserId._id.toString() === userId || conv.parentUserId.toString() === userId;
  const isTeacher = conv.teacherUserId._id.toString() === userId || conv.teacherUserId.toString() === userId;
  if (!isParent && !isTeacher) {
    return { error: { status: 403, message: "You do not have access to this conversation" } };
  }
  return { conversation: conv };
}

exports.getConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, conversation } = await ensureCanAccessConversation(req, id);
    if (error) return res.status(error.status).json({ message: error.message });
    res.json({
      data: {
        _id: conversation._id,
        student: conversation.studentId,
        parent: conversation.parentUserId,
        teacher: conversation.teacherUserId,
        school: conversation.schoolId,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt,
      },
    });
  } catch (error) {
    console.error("getConversation error:", error);
    res.status(500).json({ message: "Error fetching conversation" });
  }
};

// Get messages (paginated, newest first)
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, conversation } = await ensureCanAccessConversation(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      Message.find({ conversationId: id })
        .populate("senderId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments({ conversationId: id }),
    ]);

    // Return chronological order (oldest first) for display
    messages.reverse();

    res.json({
      data: messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("getMessages error:", error);
    res.status(500).json({ message: "Error fetching messages" });
  }
};

// Send a message in an existing conversation
exports.sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, isUrgent } = req.body;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ message: "content is required" });
    }

    const { error, conversation } = await ensureCanAccessConversation(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const message = await Message.create({
      conversationId: id,
      senderId: req.user.id,
      content: content.trim(),
      isUrgent: !!isUrgent,
    });
    conversation.lastMessageAt = new Date();
    conversation.status = "open";
    await conversation.save();

    const populated = await Message.findById(message._id).populate("senderId", "name").lean();
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error("sendMessage error:", error);
    res.status(500).json({ message: "Error sending message" });
  }
};

// Mark conversation as resolved (teacher only)
exports.markResolved = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, conversation } = await ensureCanAccessConversation(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    const teacherId = conversation.teacherUserId._id || conversation.teacherUserId;
    if (teacherId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only the class teacher can mark as resolved" });
    }

    conversation.status = "resolved";
    await conversation.save();
    res.json({ message: "Conversation marked as resolved", data: conversation });
  } catch (error) {
    console.error("markResolved error:", error);
    res.status(500).json({ message: "Error updating conversation" });
  }
};

// Reopen conversation (parent or teacher)
exports.reopenConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, conversation } = await ensureCanAccessConversation(req, id);
    if (error) return res.status(error.status).json({ message: error.message });

    conversation.status = "open";
    await conversation.save();
    res.json({ message: "Conversation reopened", data: conversation });
  } catch (error) {
    console.error("reopenConversation error:", error);
    res.status(500).json({ message: "Error updating conversation" });
  }
};

// School admin: list all conversations for their school (audit)
exports.listBySchool = async (req, res) => {
  try {
    if (req.user.role !== "school_admin" && req.user.role !== "admin") {
      return res.status(403).json({ message: "Only school admins can list conversations by school" });
    }
    const schoolId = req.user.schoolId || req.query.schoolId;
    if (!schoolId) {
      return res.status(400).json({ message: "schoolId is required" });
    }
    const conversations = await Conversation.find({ schoolId })
      .populate("studentId", "name")
      .populate("parentUserId", "name email")
      .populate("teacherUserId", "name email")
      .populate("schoolId", "name")
      .sort({ lastMessageAt: -1 })
      .lean();

    const convIds = conversations.map((c) => c._id);
    const lastMessages = await Message.aggregate([
      { $match: { conversationId: { $in: convIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$conversationId", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);
    const lastByConv = new Map(lastMessages.map((m) => [m.conversationId.toString(), m]));

    const data = conversations.map((c) => {
      const last = lastByConv.get(c._id.toString());
      return {
        _id: c._id,
        student: c.studentId,
        parent: c.parentUserId,
        teacher: c.teacherUserId,
        school: c.schoolId,
        status: c.status,
        lastMessageAt: c.lastMessageAt,
        lastMessage: last
          ? { content: last.content, isUrgent: last.isUrgent, createdAt: last.createdAt }
          : null,
      };
    });

    res.json({ data });
  } catch (error) {
    console.error("listBySchool error:", error);
    res.status(500).json({ message: "Error fetching conversations" });
  }
};
