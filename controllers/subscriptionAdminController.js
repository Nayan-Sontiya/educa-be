const BillingSettings = require("../models/BillingSettings");
const SchoolSubscription = require("../models/SchoolSubscription");
const School = require("../models/School");

exports.getBillingSettings = async (req, res) => {
  try {
    let doc = await BillingSettings.findById("global");
    if (!doc) {
      doc = await BillingSettings.create({
        _id: "global",
        pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
      });
    }
    return res.json({ data: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};

exports.patchBillingSettings = async (req, res) => {
  try {
    const { pricePerStudentYearInr, reminderOffsetsDays } = req.body;
    let doc = await BillingSettings.findById("global");
    if (!doc) doc = new BillingSettings({ _id: "global" });
    if (pricePerStudentYearInr != null) doc.pricePerStudentYearInr = Number(pricePerStudentYearInr);
    if (Array.isArray(reminderOffsetsDays)) doc.reminderOffsetsDays = reminderOffsetsDays;
    await doc.save();
    return res.json({ data: doc, message: "Updated" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};

exports.listSchoolSubscriptions = async (req, res) => {
  try {
    const subs = await SchoolSubscription.find()
      .populate("schoolId", "name email verificationStatus")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ data: subs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};

exports.patchSchoolSubscription = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { adminUnblockUntil, adminNote, forceStatus } = req.body;

    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ message: "School not found" });

    let sub = await SchoolSubscription.findOne({ schoolId });
    if (!sub) {
      sub = new SchoolSubscription({ schoolId, status: "inactive" });
    }

    if (adminUnblockUntil !== undefined) {
      sub.adminUnblockUntil = adminUnblockUntil ? new Date(adminUnblockUntil) : undefined;
    }
    if (adminNote !== undefined) sub.adminNote = adminNote;
    if (
      forceStatus &&
      ["active", "trialing", "inactive"].includes(forceStatus)
    ) {
      sub.status = forceStatus;
    }

    await sub.save();
    return res.json({ data: sub, message: "Updated" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};
