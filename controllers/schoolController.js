// controllers/schoolController.js
const School = require("../models/School");
const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Class = require("../models/Class");
const Review = require("../models/Review");
const bcrypt = require("bcryptjs");
const udiseService = require("../utils/udiseService");
const { createDefaultClasses } = require("../utils/createDefaultClasses");
const { getRelativePath, getFileUrl, getFileUrls, convertDocumentsToUrls } = require("../utils/fileUrlHelper");
const { normalizePhone } = require("../utils/phone");
const {
  notifySchoolRegistered,
  notifySchoolStatusChanged,
} = require("../utils/schoolEmailNotifications");

// Register school (public). Expects multipart/form-data for file uploads.
exports.registerSchool = async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};

    const {
      name,
      udiseCode,
      affiliationBoard,
      affiliationNumber,
      yearEstablished,
      schoolType,
      schoolCategory,
      description,
      addressLine1,
      addressLine2,
      city,
      pincode,
      adminName,
      adminDesignation,
      adminEmail,
      adminMobile,
      username,
      password,
    } = body;

    // Basic required checks
    if (
      !name ||
      !udiseCode ||
      !affiliationBoard ||
      !affiliationNumber ||
      !addressLine1 ||
      !city ||
      !pincode ||
      !adminName ||
      !adminEmail ||
      !adminMobile ||
      !username ||
      !password
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Duplicate checks
    const existing = await School.findOne({
      $or: [{ email: adminEmail }, { udiseCode }],
    });
    if (existing)
      return res
        .status(400)
        .json({ message: "This school or admin email is already registered." });

    // UDISE verification (stub)
    const udiseResult = await udiseService.verifyUdise(udiseCode);

    // Create user (school admin)
    const userExists = await User.findOne({ email: adminEmail });
    if (userExists)
      return res
        .status(400)
        .json({ message: "Admin email already registered as user" });

    const hash = await bcrypt.hash(password, 10);
    const pn = normalizePhone(adminMobile);
    const user = await User.create({
      name: adminName,
      email: adminEmail,
      password: hash,
      role: "school_admin",
      phone: adminMobile,
      ...(pn ? { phoneNormalized: pn } : {}),
    });

    // Save file paths (if provided) - convert absolute paths to relative paths
    const documents = {};
    if (files.registrationCertificate && files.registrationCertificate[0])
      documents.registrationCertificate = getRelativePath(files.registrationCertificate[0].path);
    if (files.affiliationCertificate && files.affiliationCertificate[0])
      documents.affiliationCertificate = getRelativePath(files.affiliationCertificate[0].path);
    if (files.principalIdProof && files.principalIdProof[0])
      documents.principalIdProof = getRelativePath(files.principalIdProof[0].path);

    // Save gallery images (if provided) - convert absolute paths to relative paths
    const gallery = [];
    if (files.gallery && Array.isArray(files.gallery)) {
      gallery.push(...files.gallery.map((file) => getRelativePath(file.path)));
    }

    // create school
    const school = await School.create({
      name,
      udiseCode,
      affiliationBoard,
      affiliationNumber,
      yearEstablished,
      schoolType,
      schoolCategory,
      description,
      addressLine1,
      addressLine2,
      city,
      pincode,
      district: udiseResult?.district,
      state: udiseResult?.state,
      udiseVerified: !!udiseResult?.valid,
      email: adminEmail,
      phone: adminMobile,
      authorizedPerson: {
        fullName: adminName,
        designation: adminDesignation,
        officialEmail: adminEmail,
        mobile: adminMobile,
      },
      documents,
      listing: {
        gallery: gallery, // Add gallery images to listing
      },
      verificationStatus: "Pending",
      createdBy: user._id,
    });

    // link user -> school
    user.schoolId = school._id;
    await createDefaultClasses(school._id);
    await user.save();

    // Convert file paths to full URLs for response
    const schoolResponse = {
      ...school.toObject(),
      documents: convertDocumentsToUrls(school.documents, req),
      listing: school.listing ? {
        ...school.listing.toObject(),
        gallery: school.listing.gallery ? getFileUrls(school.listing.gallery, req) : [],
      } : {},
    };

    res.status(201).json({ message: "School registered successfully", school: schoolResponse });

    notifySchoolRegistered({
      school: school.toObject ? school.toObject() : school,
      adminName: user.name,
    })
      .then((result) => {
        if (result?.sent) {
          console.log("[mail] school registration — SENT", {
            to: school.email,
            messageId: result.messageId,
          });
        } else if (result?.skipped) {
          console.log("[mail] school registration — SKIPPED", {
            to: school.email,
            reason: result.reason,
          });
        } else if (result?.error) {
          console.error("[mail] school registration — FAILED", {
            error: result.error.message,
          });
        }
      })
      .catch((err) =>
        console.error("[mail] school registration — exception:", err)
      );
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error registering school" });
  }
};

const ALLOWED_VERIFICATION_STATUSES = [
  "Pending",
  "Verified",
  "Rejected",
  "Blocked",
  "Suspended",
  "NeedMoreInfo",
];

/** Public: verified schools only (e.g. teacher signup, mobile app) */
exports.getSchoolsVerifiedPublic = async (req, res) => {
  try {
    const schools = await School.find({ verificationStatus: "Verified" })
      .select("name city state email phone verificationStatus udiseCode")
      .sort({ name: 1 })
      .lean();
    res.json(schools);
  } catch (error) {
    console.error("getSchoolsVerifiedPublic:", error);
    res.status(500).json({ message: "Error fetching schools" });
  }
};

/** Platform admin: list all schools (optionally filter by verificationStatus) */
exports.getSchoolsForAdmin = async (req, res) => {
  try {
    const { status } = req.query;
    const q = {};
    if (status && ALLOWED_VERIFICATION_STATUSES.includes(status)) {
      q.verificationStatus = status;
    }
    const schools = await School.find(q)
      .populate("createdBy", "name email phone role")
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      success: true,
      data: schools,
      count: schools.length,
    });
  } catch (error) {
    console.error("getSchoolsForAdmin:", error);
    res.status(500).json({ success: false, message: "Error fetching schools" });
  }
};

/** Platform admin: dashboard aggregates */
exports.getPlatformSchoolStats = async (req, res) => {
  try {
    const [
      totalSchools,
      pendingSchools,
      verifiedSchools,
      rejectedSchools,
      blockedSchools,
      suspendedSchools,
      needMoreInfoSchools,
      totalTeachers,
      totalStudents,
    ] = await Promise.all([
      School.countDocuments(),
      School.countDocuments({ verificationStatus: "Pending" }),
      School.countDocuments({ verificationStatus: "Verified" }),
      School.countDocuments({ verificationStatus: "Rejected" }),
      School.countDocuments({ verificationStatus: "Blocked" }),
      School.countDocuments({ verificationStatus: "Suspended" }),
      School.countDocuments({ verificationStatus: "NeedMoreInfo" }),
      Teacher.countDocuments(),
      Student.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        totalSchools,
        pendingApproval: pendingSchools,
        activeSchools: verifiedSchools,
        rejectedSchools,
        blockedSchools,
        suspendedSchools,
        needMoreInfoSchools,
        totalTeachers,
        totalStudents,
      },
    });
  } catch (error) {
    console.error("getPlatformSchoolStats:", error);
    res.status(500).json({ success: false, message: "Error fetching stats" });
  }
};

/** Platform admin: per-school counts */
exports.getSchoolAdminSummary = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId)
      .populate("createdBy", "name email phone")
      .lean();
    if (!school) {
      return res.status(404).json({ success: false, message: "School not found" });
    }
    const sid = school._id;
    const [teacherCount, studentCount, classCount] = await Promise.all([
      Teacher.countDocuments({ schoolId: sid }),
      Student.countDocuments({ schoolId: sid }),
      Class.countDocuments({ schoolId: sid }),
    ]);
    res.json({
      success: true,
      data: {
        school,
        counts: {
          teachers: teacherCount,
          students: studentCount,
          classes: classCount,
        },
      },
    });
  } catch (error) {
    console.error("getSchoolAdminSummary:", error);
    res.status(500).json({ success: false, message: "Error fetching summary" });
  }
};

const PLATFORM_SCHOOL_LIST_LIMIT = 150;

/** Platform admin: school profile + roster previews (teachers, students, classes) */
exports.getPlatformSchoolDetail = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const schoolRaw = await School.findById(schoolId)
      .populate("createdBy", "name email phone role username")
      .lean();
    if (!schoolRaw) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    const { otp: _otp, ...restSchool } = schoolRaw;
    const school = {
      ...restSchool,
      documents: convertDocumentsToUrls(schoolRaw.documents || {}, req),
      listing: schoolRaw.listing
        ? {
            ...schoolRaw.listing,
            gallery: getFileUrls(schoolRaw.listing.gallery || [], req),
          }
        : schoolRaw.listing,
    };

    const sid = school._id;
    const [
      teacherCount,
      studentCount,
      classCount,
      teachers,
      students,
      classes,
    ] = await Promise.all([
      Teacher.countDocuments({ schoolId: sid }),
      Student.countDocuments({ schoolId: sid }),
      Class.countDocuments({ schoolId: sid }),
      Teacher.find({ schoolId: sid })
        .populate("userId", "name email phone username role")
        .select("userId phone status createdAt")
        .sort({ createdAt: -1 })
        .limit(PLATFORM_SCHOOL_LIST_LIMIT)
        .lean(),
      Student.find({ schoolId: sid })
        .select("name rollNumber gender status admissionDate classSectionId createdAt")
        .populate({
          path: "classSectionId",
          select: "classId sectionId",
          populate: [
            { path: "classId", select: "name" },
            { path: "sectionId", select: "name" },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(PLATFORM_SCHOOL_LIST_LIMIT)
        .lean(),
      Class.find({ schoolId: sid })
        .select("name order status createdAt")
        .sort({ order: 1 })
        .limit(PLATFORM_SCHOOL_LIST_LIMIT)
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        school,
        counts: {
          teachers: teacherCount,
          students: studentCount,
          classes: classCount,
        },
        listLimits: {
          maxPerSection: PLATFORM_SCHOOL_LIST_LIMIT,
          teachersReturned: teachers.length,
          studentsReturned: students.length,
          classesReturned: classes.length,
        },
        teachers,
        students,
        classes,
      },
    });
  } catch (error) {
    console.error("getPlatformSchoolDetail:", error);
    res.status(500).json({ success: false, message: "Error fetching school detail" });
  }
};

// Get a single school with review summaries (for school detail page)
exports.getSchoolWithReviews = async (req, res) => {
  try {
    const { id } = req.params;

    const school = await School.findById(id)
      .select("name city state pincode email phone listing verificationStatus")
      .lean();

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Only return verified schools
    if (school.verificationStatus !== "Verified") {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Get review summaries
    const reviewStats = await Review.getAverageRating(school._id);

    // Convert file paths to full URLs
    const schoolData = {
      ...school,
      listing: school.listing ? {
        ...school.listing,
        gallery: school.listing.gallery ? getFileUrls(school.listing.gallery, req) : [],
      } : {},
    };

    res.json({
      success: true,
      data: {
        ...schoolData,
        reviewStats: {
          averageRating: reviewStats.averageRating,
          totalReviews: reviewStats.totalReviews,
          ratingDistribution: reviewStats.ratingDistribution,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching school with reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching school",
    });
  }
};

// Get all schools with review summaries (for public school listing/discovery page)
exports.getSchoolsWithReviews = async (req, res) => {
  try {
    const { city, state, search, minRating, page = 1, limit = 20 } = req.query;

    const query = { verificationStatus: "Verified" }; // Only show verified schools

    if (city) query.city = { $regex: city, $options: "i" };
    if (state) query.state = { $regex: state, $options: "i" };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { city: { $regex: search, $options: "i" } },
        { state: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const schools = await School.find(query)
      .select("name city state pincode email phone listing verificationStatus")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get review summaries for each school
    const schoolsWithReviews = await Promise.all(
      schools.map(async (school) => {
        const reviewStats = await Review.getAverageRating(school._id);
        
        // Filter by minRating if provided
        if (minRating && reviewStats.averageRating < parseFloat(minRating)) {
          return null;
        }

        // Convert file paths to full URLs
        const schoolData = {
          ...school,
          listing: school.listing ? {
            ...school.listing,
            gallery: school.listing.gallery ? getFileUrls(school.listing.gallery, req) : [],
          } : {},
        };

        return {
          ...schoolData,
          reviewStats: {
            averageRating: reviewStats.averageRating,
            totalReviews: reviewStats.totalReviews,
            ratingDistribution: reviewStats.ratingDistribution,
          },
        };
      })
    );

    // Remove null entries (filtered out by minRating)
    const filteredSchools = schoolsWithReviews.filter((school) => school !== null);

    const total = await School.countDocuments(query);

    res.json({
      success: true,
      data: filteredSchools,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching schools with reviews:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching schools",
    });
  }
};

// Dev: send OTP to mobile (stores OTP on school record or returns to client for dev)
exports.sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ message: "Mobile is required" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // In a real system, send SMS via provider and do not return the OTP.

    // store OTP in a temporary collection or a School document if school exists. For now return code in response.
    res.json({ message: "OTP sent (dev)", code });
  } catch (err) {
    res.status(500).json({ message: "Error sending OTP" });
  }
};

// Dev: verify OTP (stub)
exports.verifyOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    // In dev we accept any OTP of 6 digits. In production validate against stored code.
    if (!mobile || !otp)
      return res.status(400).json({ message: "Missing mobile or otp" });
    if (!/^[0-9]{6}$/.test(otp))
      return res.status(400).json({ message: "Invalid OTP" });
    res.json({ message: "OTP verified" });
  } catch (err) {
    res.status(500).json({ message: "Error verifying OTP" });
  }
};

// Platform admin: update verification / approval workflow
exports.updateVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, reviewNote } = req.body;
    if (!ALLOWED_VERIFICATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const school = await School.findById(id);
    if (!school) return res.status(404).json({ message: "School not found" });

    const previousStatus = school.verificationStatus;

    if (status === "Verified" && previousStatus !== "Verified") {
      school.verifiedAt = new Date();
    }

    school.verificationStatus = status;
    if (status === "Rejected") {
      if (rejectionReason !== undefined) {
        school.rejectionReason = rejectionReason
          ? String(rejectionReason).trim()
          : undefined;
      }
      school.reviewNote = undefined;
    } else if (status === "NeedMoreInfo") {
      if (reviewNote !== undefined) {
        school.reviewNote = reviewNote ? String(reviewNote).trim() : undefined;
      }
      school.rejectionReason = undefined;
    } else {
      school.rejectionReason = undefined;
      school.reviewNote = undefined;
    }
    await school.save();
    res.json({
      success: true,
      message: "School status updated",
      data: school,
    });

    // Email on every successful PATCH (even if status value unchanged — e.g. re-save / repeat apply)
    console.log("[mail] verification PATCH — notify queued", {
      schoolId: String(school._id),
      previousStatus,
      newStatus: status,
      statusUnchanged: previousStatus === status,
      recipient: school.email || null,
    });

    notifySchoolStatusChanged({
      school: school.toObject(),
      previousStatus,
      newStatus: status,
      rejectionReason:
        status === "Rejected" ? school.rejectionReason : undefined,
      reviewNote: status === "NeedMoreInfo" ? school.reviewNote : undefined,
    })
      .then((result) => {
        if (result?.sent) {
          console.log("[mail] verification PATCH — notify SENT", {
            schoolId: String(school._id),
            to: school.email,
            messageId: result.messageId,
          });
        } else if (result?.skipped) {
          console.log("[mail] verification PATCH — notify SKIPPED", {
            schoolId: String(school._id),
            to: school.email,
            reason: result.reason,
          });
        } else if (result?.error) {
          console.error("[mail] verification PATCH — notify FAILED", {
            schoolId: String(school._id),
            error: result.error.message,
          });
        }
      })
      .catch((err) =>
        console.error("[mail] verification PATCH — notify exception:", err)
      );
  } catch (err) {
    console.error("updateVerification:", err);
    res.status(500).json({ message: "Error updating verification" });
  }
};

// Update paid leave count for school
exports.updatePaidLeaveCount = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { paidLeaveCount } = req.body;

    if (paidLeaveCount === undefined || paidLeaveCount === null) {
      return res.status(400).json({
        success: false,
        message: "paidLeaveCount is required",
      });
    }

    if (paidLeaveCount < 0) {
      return res.status(400).json({
        success: false,
        message: "paidLeaveCount cannot be negative",
      });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    school.paidLeaveCount = paidLeaveCount;
    await school.save();

    res.status(200).json({
      success: true,
      data: school,
      message: "Paid leave count updated successfully",
    });
  } catch (error) {
    console.error("Error updating paid leave count:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update paid leave count",
    });
  }
};

// Get school details including paid leave count
exports.getMySchool = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const school = await School.findById(schoolId).select(
      "name email paidLeaveCount verificationStatus listing"
    );

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Convert file paths to full URLs
    const schoolData = {
      ...school.toObject(),
      listing: school.listing ? {
        ...school.listing.toObject(),
        gallery: school.listing.gallery ? getFileUrls(school.listing.gallery, req) : [],
      } : {},
    };

    res.status(200).json({
      success: true,
      data: schoolData,
    });
  } catch (error) {
    console.error("Error fetching school:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch school",
    });
  }
};

// Get school listing information
exports.getSchoolListing = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const school = await School.findById(schoolId).select(
      "name listing verificationStatus"
    );

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Convert file paths to full URLs
    const listing = school.listing ? {
      ...school.listing.toObject(),
      gallery: school.listing.gallery ? getFileUrls(school.listing.gallery, req) : [],
    } : {};

    res.status(200).json({
      success: true,
      data: {
        name: school.name,
        listing: listing,
        verificationStatus: school.verificationStatus,
      },
    });
  } catch (error) {
    console.error("Error fetching school listing:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch school listing",
    });
  }
};

// Update school listing information
exports.updateSchoolListing = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const {
      about,
      vision,
      mission,
      contactNumber,
      contactEmail,
      websiteUrl,
      admissionStatus,
      facilities,
      mapLocation,
    } = req.body;

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Initialize listing if it doesn't exist
    if (!school.listing) {
      school.listing = {};
    }

    // Update fields if provided
    if (about !== undefined) school.listing.about = about;
    if (vision !== undefined) school.listing.vision = vision;
    if (mission !== undefined) school.listing.mission = mission;
    if (contactNumber !== undefined)
      school.listing.contactNumber = contactNumber;
    if (contactEmail !== undefined) school.listing.contactEmail = contactEmail;
    if (websiteUrl !== undefined) school.listing.websiteUrl = websiteUrl;
    if (admissionStatus !== undefined) {
      if (["open", "closed"].includes(admissionStatus)) {
        school.listing.admissionStatus = admissionStatus;
      }
    }
    if (facilities !== undefined) {
      school.listing.facilities = Array.isArray(facilities) ? facilities : [];
    }
    if (mapLocation !== undefined) {
      school.listing.mapLocation = mapLocation;
    }

    await school.save();

    res.status(200).json({
      success: true,
      data: school.listing,
      message: "School listing updated successfully",
    });
  } catch (error) {
    console.error("Error updating school listing:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update school listing",
    });
  }
};

// Update school gallery
exports.updateSchoolGallery = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const files = req.files || {};
    const galleryFiles = files.gallery || [];

    const school = await School.findById(schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // Initialize listing if it doesn't exist
    if (!school.listing) {
      school.listing = {};
    }
    if (!school.listing.gallery) {
      school.listing.gallery = [];
    }

    // Add new images (max 10 total)
    const newImages = galleryFiles.map((file) => getRelativePath(file.path));
    const totalImages = school.listing.gallery.length + newImages.length;

    if (totalImages > 10) {
      return res.status(400).json({
        success: false,
        message: "Maximum 10 images allowed in gallery",
      });
    }

    school.listing.gallery = [...school.listing.gallery, ...newImages];

    await school.save();

    // Convert file paths to full URLs
    const galleryUrls = getFileUrls(school.listing.gallery, req);

    res.status(200).json({
      success: true,
      data: galleryUrls,
      message: "Gallery updated successfully",
    });
  } catch (error) {
    console.error("Error updating school gallery:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update school gallery",
    });
  }
};

// Remove image from gallery
exports.removeGalleryImage = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { imagePath } = req.body;

    if (!imagePath) {
      return res.status(400).json({
        success: false,
        message: "Image path is required",
      });
    }

    const school = await School.findById(schoolId);

    if (!school || !school.listing || !school.listing.gallery) {
      return res.status(404).json({
        success: false,
        message: "School or gallery not found",
      });
    }

    school.listing.gallery = school.listing.gallery.filter(
      (path) => path !== imagePath
    );

    await school.save();

    res.status(200).json({
      success: true,
      data: school.listing.gallery,
      message: "Image removed successfully",
    });
  } catch (error) {
    console.error("Error removing gallery image:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to remove gallery image",
    });
  }
};