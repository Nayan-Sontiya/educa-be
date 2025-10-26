// controllers/schoolController.js
const School = require("../models/School");

exports.registerSchool = async (req, res) => {
  try {
    const {
      name,
      udiseCode,
      affiliationBoard,
      affiliationNumber,
      yearEstablished,
      schoolType,
      schoolCategory,
      description,
      email,
      phone,
      address
    } = req.body;

    const existing = await School.findOne({ $or: [ { email }, { udiseCode } ] });
    if (existing)
      return res.status(400).json({ message: "School already registered with this email or UDISE+ code" });

    const school = await School.create({
      name,
      udiseCode,
      affiliationBoard,
      affiliationNumber,
      yearEstablished,
      schoolType,
      schoolCategory,
      description,
      email,
      phone,
      address,
      createdBy: req.user.id, // user from JWT token
    });

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
