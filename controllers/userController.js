// controllers/userController.js
const User = require("../models/User");

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().populate("schoolId", "name");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
  }
};

exports.assignSchool = async (req, res) => {
  try {
    const { userId, schoolId } = req.body;
    const user = await User.findByIdAndUpdate(
      userId,
      { schoolId },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "School assigned successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Error assigning school" });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Role updated successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Error updating role" });
  }
};
