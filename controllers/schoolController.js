// controllers/schoolController.js
const School = require("../models/School");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const udiseService = require("../utils/udiseService");
const { createDefaultClasses } = require("../utils/createDefaultClasses");

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
    const user = await User.create({
      name: adminName,
      email: adminEmail,
      password: hash,
      role: "school_admin",
    });

    // Save file paths (if provided)
    const documents = {};
    if (files.registrationCertificate && files.registrationCertificate[0])
      documents.registrationCertificate = files.registrationCertificate[0].path;
    if (files.affiliationCertificate && files.affiliationCertificate[0])
      documents.affiliationCertificate = files.affiliationCertificate[0].path;
    if (files.principalIdProof && files.principalIdProof[0])
      documents.principalIdProof = files.principalIdProof[0].path;

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
      verificationStatus: "Pending",
      createdBy: user._id,
    });

    // link user -> school
    user.schoolId = school._id;
    await createDefaultClasses(school._id);
    await user.save();

    res.status(201).json({ message: "School registered successfully", school });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error registering school" });
  }
};

exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find().populate("createdBy", "name email");
    res.json(schools);
  } catch (error) {
    res.status(500).json({ message: "Error fetching schools" });
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

// Admin review endpoint to update verification status
exports.updateVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Expected: Verified or Rejected
    if (!["Verified", "Rejected", "Pending"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const school = await School.findById(id);
    if (!school) return res.status(404).json({ message: "School not found" });

    school.verificationStatus = status;
    await school.save();
    res.json({ message: "School verification updated", school });
  } catch (err) {
    res.status(500).json({ message: "Error updating verification" });
  }
};
