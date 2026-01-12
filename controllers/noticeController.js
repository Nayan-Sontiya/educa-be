// controllers/noticeController.js
const Notice = require("../models/Notice");
const School = require("../models/School");

// Create a new notice
const createNotice = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      targetAudience,
      classSectionIds,
      publishDate,
      expiryDate,
      isPinned,
      isAcknowledgeRequired,
      attachments,
    } = req.body;

    // Validation
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    if (!type || !["Holiday", "Event", "Emergency", "Exam", "Fees", "General"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Valid notice type is required",
      });
    }

    if (!targetAudience || !["All", "Teachers Only", "Students Only", "Specific Class"].includes(targetAudience)) {
      return res.status(400).json({
        success: false,
        message: "Valid target audience is required",
      });
    }

    if (targetAudience === "Specific Class" && (!classSectionIds || classSectionIds.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Class sections are required for 'Specific Class' target audience",
      });
    }

    // Validate dates
    if (publishDate && expiryDate) {
      const pubDate = new Date(publishDate);
      const expDate = new Date(expiryDate);
      
      if (pubDate >= expDate) {
        return res.status(400).json({
          success: false,
          message: "Expiry date must be after publish date",
        });
      }
    }

    // Get school ID from user
    const schoolId = req.user.schoolId || req.body.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    // Verify school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Determine status based on publish date
    let status = "draft";
    const now = new Date();
    const pubDate = publishDate ? new Date(publishDate) : now;

    if (pubDate <= now) {
      status = "published";
    }

    // Create notice
    const notice = await Notice.create({
      schoolId,
      createdBy: req.user.id,
      title,
      description,
      type,
      targetAudience,
      classSectionIds: targetAudience === "Specific Class" ? classSectionIds : [],
      attachments: attachments || [],
      publishDate: pubDate,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      status,
      isPinned: isPinned || false,
      isAcknowledgeRequired: isAcknowledgeRequired || false,
    });

    const populatedNotice = await Notice.findById(notice._id)
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    res.status(201).json({
      success: true,
      data: populatedNotice,
      message: "Notice created successfully",
    });
  } catch (error) {
    console.error("Error creating notice:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create notice",
    });
  }
};

// Get all notices for admin (with filters)
const getAllNotices = async (req, res) => {
  try {
    const { status, type, targetAudience, page = 1, limit = 10 } = req.query;
    const schoolId = req.user.schoolId || req.query.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    const query = { schoolId };

    if (status) {
      query.status = status;
    }
    if (type) {
      query.type = type;
    }
    if (targetAudience) {
      query.targetAudience = targetAudience;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notices = await Notice.find(query)
      .sort({ isPinned: -1, publishDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    const total = await Notice.countDocuments(query);

    res.status(200).json({
      success: true,
      data: notices,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      message: "Notices retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching notices:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch notices",
    });
  }
};

// Get active notices for users (teachers, students, parents)
const getActiveNotices = async (req, res) => {
  try {
    const { classSectionId } = req.query;
    const schoolId = req.user.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    // Determine target audience based on user role
    const userRole = req.user.role?.toLowerCase();
    let targetAudience = "All";

    if (userRole === "teacher") {
      targetAudience = "Teachers Only";
    } else if (userRole === "student") {
      targetAudience = "Students Only";
    }

    // Get notices using the static method (it already handles "All" audience)
    const notices = await Notice.findActiveNotices(
      schoolId,
      targetAudience,
      classSectionId
    );

    // Sort by pinned first, then by publish date
    notices.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.publishDate) - new Date(a.publishDate);
    });

    res.status(200).json({
      success: true,
      data: notices,
      total: notices.length,
      message: "Active notices retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching active notices:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch active notices",
    });
  }
};

// Get single notice by ID
const getNoticeById = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId;

    const notice = await Notice.findOne({ _id: id, schoolId })
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Notice not found",
      });
    }

    res.status(200).json({
      success: true,
      data: notice,
      message: "Notice retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching notice:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch notice",
    });
  }
};

// Update notice
const updateNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      type,
      targetAudience,
      classSectionIds,
      publishDate,
      expiryDate,
      status,
      isPinned,
      isAcknowledgeRequired,
      attachments,
    } = req.body;

    const schoolId = req.user.schoolId;

    const notice = await Notice.findOne({ _id: id, schoolId });

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Notice not found",
      });
    }

    // Update fields
    if (title !== undefined) notice.title = title;
    if (description !== undefined) notice.description = description;
    if (type !== undefined) notice.type = type;
    if (targetAudience !== undefined) notice.targetAudience = targetAudience;
    if (classSectionIds !== undefined) {
      notice.classSectionIds =
        targetAudience === "Specific Class" ? classSectionIds : [];
    }
    if (attachments !== undefined) notice.attachments = attachments;
    if (publishDate !== undefined) {
      notice.publishDate = new Date(publishDate);
      // Update status based on publish date
      const now = new Date();
      if (new Date(publishDate) <= now && notice.status === "draft") {
        notice.status = "published";
      }
    }
    if (expiryDate !== undefined) {
      notice.expiryDate = expiryDate ? new Date(expiryDate) : null;
      
      // Validate expiry date is after publish date
      if (notice.expiryDate && notice.publishDate && notice.expiryDate <= notice.publishDate) {
        return res.status(400).json({
          success: false,
          message: "Expiry date must be after publish date",
        });
      }
    }
    if (status !== undefined) notice.status = status;
    if (isPinned !== undefined) notice.isPinned = isPinned;
    if (isAcknowledgeRequired !== undefined)
      notice.isAcknowledgeRequired = isAcknowledgeRequired;

    // Check expiry
    if (
      notice.expiryDate &&
      new Date() > notice.expiryDate &&
      notice.status === "published"
    ) {
      notice.status = "expired";
    }

    await notice.save();

    const updatedNotice = await Notice.findById(notice._id)
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    res.status(200).json({
      success: true,
      data: updatedNotice,
      message: "Notice updated successfully",
    });
  } catch (error) {
    console.error("Error updating notice:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update notice",
    });
  }
};

// Delete notice
const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId;

    const notice = await Notice.findOneAndDelete({ _id: id, schoolId });

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Notice not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notice deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting notice:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to delete notice",
    });
  }
};

// Track view (for analytics)
const trackView = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notice = await Notice.findById(id);

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Notice not found",
      });
    }

    await notice.trackView(userId);

    // Return updated notice with view tracking
    const updatedNotice = await Notice.findById(id)
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    res.status(200).json({
      success: true,
      data: updatedNotice,
      message: "View tracked successfully",
    });
  } catch (error) {
    console.error("Error tracking view:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to track view",
    });
  }
};

// Acknowledge notice
const acknowledgeNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notice = await Notice.findById(id);

    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Notice not found",
      });
    }

    await notice.acknowledge(userId);

    // Return updated notice with acknowledgement
    const updatedNotice = await Notice.findById(id)
      .populate("createdBy", "name email")
      .populate("classSectionIds", "className sectionName");

    res.status(200).json({
      success: true,
      data: updatedNotice,
      message: "Notice acknowledged successfully",
    });
  } catch (error) {
    console.error("Error acknowledging notice:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to acknowledge notice",
    });
  }
};

// Get notice statistics
const getNoticeStats = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    const total = await Notice.countDocuments({ schoolId });
    const published = await Notice.countDocuments({
      schoolId,
      status: "published",
    });
    const draft = await Notice.countDocuments({ schoolId, status: "draft" });
    const expired = await Notice.countDocuments({
      schoolId,
      status: "expired",
    });
    const pinned = await Notice.countDocuments({
      schoolId,
      isPinned: true,
      status: "published",
    });

    res.status(200).json({
      success: true,
      data: {
        total,
        published,
        draft,
        expired,
        pinned,
      },
      message: "Notice statistics retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching notice stats:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch notice statistics",
    });
  }
};

module.exports = {
  createNotice,
  getAllNotices,
  getActiveNotices,
  getNoticeById,
  updateNotice,
  deleteNotice,
  trackView,
  acknowledgeNotice,
  getNoticeStats,
};

