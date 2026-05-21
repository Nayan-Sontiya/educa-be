const BillingSettings = require("../models/BillingSettings");
const SchoolSubscription = require("../models/SchoolSubscription");
const School = require("../models/School");
const {
  computeTrialEndsAt,
  loadGlobalBillingSettings,
  envDefaultTrialWeeks,
} = require("../utils/subscriptionAccess");

async function ensureBillingSettingsDoc() {
  let doc = await BillingSettings.findById("global");
  if (!doc) {
    doc = await BillingSettings.create({
      _id: "global",
      pricePerStudentYearInr: Number(process.env.SUBSCRIPTION_PRICE_PER_STUDENT_YEAR_INR) || 300,
      freeTrialEnabled: true,
      defaultTrialWeeks: envDefaultTrialWeeks(),
    });
  }
  return doc;
}

exports.getBillingSettings = async (req, res) => {
  try {
    const doc = await ensureBillingSettingsDoc();
    return res.json({ data: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};

exports.patchBillingSettings = async (req, res) => {
  try {
    const { pricePerStudentYearInr, reminderOffsetsDays, freeTrialEnabled, defaultTrialWeeks } =
      req.body;
    const doc = await ensureBillingSettingsDoc();
    if (pricePerStudentYearInr != null) doc.pricePerStudentYearInr = Number(pricePerStudentYearInr);
    if (Array.isArray(reminderOffsetsDays)) doc.reminderOffsetsDays = reminderOffsetsDays;
    if (freeTrialEnabled !== undefined) doc.freeTrialEnabled = Boolean(freeTrialEnabled);
    if (defaultTrialWeeks !== undefined) {
      const w = Number(defaultTrialWeeks);
      if (!Number.isFinite(w) || w < 0) {
        return res.status(400).json({ message: "defaultTrialWeeks must be a number >= 0" });
      }
      doc.defaultTrialWeeks = w;
    }
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
      .populate("schoolId", "name email verificationStatus verifiedAt freeTrialDisabled trialEndsAtOverride")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ data: subs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};

/** Verified schools with computed trial window (for platform admin). */
exports.listSchoolsTrial = async (req, res) => {
  try {
    const billing = await loadGlobalBillingSettings();
    const schools = await School.find({ verificationStatus: "Verified" })
      .select("name email verifiedAt freeTrialDisabled trialEndsAtOverride")
      .sort({ name: 1 })
      .lean();

    const schoolIds = schools.map((s) => s._id);
    const subs = await SchoolSubscription.find({ schoolId: { $in: schoolIds } })
      .select("schoolId plan status billedStudentCount")
      .lean();
    const subBySchool = new Map(subs.map((s) => [String(s.schoolId), s]));

    const now = Date.now();
    const rows = schools.map((school) => {
      const trialEndsAt = computeTrialEndsAt(school, billing);
      const trialEndMs = trialEndsAt ? trialEndsAt.getTime() : null;
      const globalOff = billing.freeTrialEnabled === false;
      const schoolOff = Boolean(school.freeTrialDisabled);
      const inTrial =
        !globalOff && !schoolOff && trialEndMs != null && now <= trialEndMs;
      const sub = subBySchool.get(String(school._id));
      return {
        schoolId: school._id,
        name: school.name,
        email: school.email,
        verifiedAt: school.verifiedAt,
        freeTrialDisabled: schoolOff,
        trialEndsAtOverride: school.trialEndsAtOverride,
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
        inTrial,
        globalFreeTrialEnabled: billing.freeTrialEnabled !== false,
        subscription: sub
          ? {
              plan: sub.plan,
              status: sub.status,
              billedStudentCount: sub.billedStudentCount,
            }
          : null,
      };
    });

    return res.json({
      data: {
        global: {
          freeTrialEnabled: billing.freeTrialEnabled !== false,
          defaultTrialWeeks: billing.defaultTrialWeeks ?? envDefaultTrialWeeks(),
        },
        schools: rows,
      },
    });
  } catch (e) {
    console.error("listSchoolsTrial:", e);
    return res.status(500).json({ message: "Failed to load schools" });
  }
};

/**
 * PATCH body:
 * - freeTrialDisabled: boolean (skip free trial for this school)
 * - trialEndsAtOverride: ISO string | null (explicit end; null clears override)
 * - endTrialNow: boolean (set override to now)
 * - extendTrialByDays: number (extend from max(now, current end))
 */
exports.patchSchoolTrial = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ message: "School not found" });
    if (school.verificationStatus !== "Verified") {
      return res.status(400).json({ message: "School must be Verified to manage trial" });
    }
    if (!school.verifiedAt) {
      return res.status(400).json({
        message: "School has no verifiedAt date. Approve the school first.",
      });
    }

    const billing = await loadGlobalBillingSettings();
    const { freeTrialDisabled, trialEndsAtOverride, endTrialNow, extendTrialByDays } = req.body || {};

    if (freeTrialDisabled !== undefined) {
      school.freeTrialDisabled = Boolean(freeTrialDisabled);
      if (school.freeTrialDisabled) {
        school.trialEndsAtOverride = undefined;
      }
    }

    if (endTrialNow === true) {
      school.trialEndsAtOverride = new Date();
      school.freeTrialDisabled = false;
    } else if (extendTrialByDays != null) {
      const days = Number(extendTrialByDays);
      if (!Number.isFinite(days) || days < 1) {
        return res.status(400).json({ message: "extendTrialByDays must be at least 1" });
      }
      const currentEnd = computeTrialEndsAt(school, billing) || new Date();
      const base = Math.max(Date.now(), currentEnd.getTime());
      school.trialEndsAtOverride = new Date(base + days * 24 * 60 * 60 * 1000);
      school.freeTrialDisabled = false;
    } else if (trialEndsAtOverride !== undefined) {
      if (trialEndsAtOverride === null || trialEndsAtOverride === "") {
        school.trialEndsAtOverride = undefined;
      } else {
        const d = new Date(trialEndsAtOverride);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid trialEndsAtOverride date" });
        }
        school.trialEndsAtOverride = d;
        school.freeTrialDisabled = false;
      }
    }

    await school.save();

    const lean = school.toObject();
    const trialEndsAt = computeTrialEndsAt(lean, billing);
    const now = Date.now();
    const inTrial =
      billing.freeTrialEnabled !== false &&
      !lean.freeTrialDisabled &&
      trialEndsAt &&
      now <= trialEndsAt.getTime();

    return res.json({
      message: "Trial updated",
      data: {
        schoolId: school._id,
        freeTrialDisabled: lean.freeTrialDisabled,
        trialEndsAtOverride: lean.trialEndsAtOverride,
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
        inTrial,
      },
    });
  } catch (e) {
    console.error("patchSchoolTrial:", e);
    return res.status(500).json({ message: "Failed to update trial" });
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
    if (forceStatus === "suspended") {
      sub.status = "inactive";
    } else if (forceStatus && ["active", "trialing", "inactive"].includes(forceStatus)) {
      sub.status = forceStatus;
    }

    await sub.save();
    return res.json({ data: sub, message: "Updated" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed" });
  }
};
