/**
 * Seed ~7 weeks of portfolio data (academic, behavior, skills, wellbeing) for one student.
 * For local testing of AI analysis, charts, and parent/teacher feedback views.
 *
 * Usage:
 *   node scripts/seedPortfolioWeeks.js [studentMongoId] [--clear]
 *
 * Examples:
 *   node scripts/seedPortfolioWeeks.js 69a7fd94ceef9efb4ae005d5
 *   node scripts/seedPortfolioWeeks.js 69a7fd94ceef9efb4ae005d5 --clear
 *
 * Requires MONGO_URI in .env (same as the API server).
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { getWeekNumber } = require("../utils/aiAnalysis");

const Student = require("../models/Student");
const { resolvePortfolioForStudent } = require("../utils/studentPortfolioResolve");

const SKILL_AREAS = [
  "communication",
  "confidence",
  "teamwork",
  "leadership",
  "creativity",
  "sports",
  "technology",
  "other",
];

const SUBJECTS = ["Mathematics", "English", "Science", "Social Studies"];
const WELLBEING = ["happy_engaged", "neutral", "low_withdrawn"];
const WELLBEING_TAGS = ["quiet", "isolated", "low_energy", "not_participating"];

/** Monday-start week (matches teacher app), stored as UTC noon to reduce TZ drift */
function mondayUtc(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(12, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function mondayWeeksAgo(n) {
  const m = mondayUtc();
  m.setUTCDate(m.getUTCDate() - n * 7);
  return m;
}

function pick(arr, i) {
  return arr[i % arr.length];
}

/** Smooth low → high → low curve over the timeline (oldest i=0 … newest i=WEEKS-1). */
function shapedPct(i, weeks, phaseRad = 0, amplitude = 52) {
  const u = weeks <= 1 ? 0.5 : i / (weeks - 1);
  const raw = 36 + amplitude * Math.sin(Math.PI * u + phaseRad);
  return Math.max(18, Math.min(96, Math.round(raw)));
}

/** Map target % to discrete behaviour/skill labels (chart uses ~100 / ~67 / ~33). */
function ratingForPct(pct) {
  if (pct >= 76) return "good";
  if (pct >= 50) return "average";
  return "needs_attention";
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--clear");
  const clear = process.argv.includes("--clear");
  const studentId = args[0] || "69a7fd94ceef9efb4ae005d5";

  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const student = await Student.findById(studentId);
  if (!student) {
    console.error("Student not found:", studentId);
    process.exit(1);
  }

  const portfolio = await resolvePortfolioForStudent(
    student,
    student.studentIdentityId
  );

  if (clear) {
    portfolio.academic = [];
    portfolio.behavior = [];
    portfolio.skills = [];
    portfolio.wellbeing = [];
    await portfolio.save();
    console.log("Cleared existing academic / behavior / skills / wellbeing arrays");
  }

  const schoolId = student.schoolId;
  const WEEKS = 7;

  for (let w = WEEKS - 1; w >= 0; w--) {
    const weekDate = mondayWeeksAgo(w);
    const weekNumber = getWeekNumber(weekDate);
    const i = WEEKS - 1 - w;
    const pctAcad = shapedPct(i, WEEKS, 0, 54);
    const pctBeh = shapedPct(i, WEEKS, -0.42, 48);
    const pctSkill = shapedPct(i, WEEKS, 0.48, 50);
    const behRating = ratingForPct(pctBeh);
    const skillRating = ratingForPct(pctSkill);

    const subjA = pick(SUBJECTS, i);
    const subjB = pick(SUBJECTS, i + 2);
    const quizMax = 100;
    const quizObt = pctAcad;
    const miniMax = 25;
    const miniObt = Math.round((pctAcad / 100) * miniMax);

    portfolio.academic.push({
      schoolId,
      weekNumber,
      term: "Term 1 2026",
      assessmentType: i % 2 === 0 ? "unit_test" : "assignment",
      subject: subjA,
      testName: `Week ${i + 1} assessment`,
      marksObtained: quizObt,
      maxMarks: quizMax,
      grade: quizObt / quizMax >= 0.75 ? "A" : quizObt / quizMax >= 0.55 ? "B" : "C",
      remarks: `Seeded wave academic (target ~${pctAcad}%).`,
      evidenceFiles: [],
      date: new Date(weekDate),
    });

    portfolio.academic.push({
      schoolId,
      weekNumber,
      assessmentType: "classwork",
      subject: subjB,
      testName: `Classwork W${i + 1}`,
      marksObtained: miniObt,
      maxMarks: miniMax,
      remarks: "Seeded second mark same week (blends into weekly %).",
      evidenceFiles: [],
      date: new Date(weekDate),
    });

    portfolio.behavior.push({
      schoolId,
      weekNumber,
      date: new Date(weekDate),
      discipline: behRating,
      respect: behRating,
      attention: behRating,
      interaction: behRating,
      teacherRemark: `Seeded behaviour wave (~${pctBeh}% band) — week ${weekNumber}.`,
    });

    SKILL_AREAS.forEach((area) => {
      portfolio.skills.push({
        schoolId,
        weekNumber,
        area,
        ratingLabel: skillRating,
        remark: area === "communication" ? `Skills wave ~${pctSkill}% band` : undefined,
        date: new Date(weekDate),
      });
    });

    const status = pick(WELLBEING, w + 1);
    const tags =
      status === "low_withdrawn" || w === 3
        ? [pick(WELLBEING_TAGS, w), pick(WELLBEING_TAGS, w + 2)].filter(
            (t, i, a) => a.indexOf(t) === i
          )
        : w % 4 === 0
          ? ["quiet"]
          : [];

    portfolio.wellbeing.push({
      schoolId,
      weekNumber,
      date: new Date(weekDate),
      status,
      tags,
      teacherRemark:
        status === "low_withdrawn"
          ? "Seeded: check-in suggested (test data)."
          : "Seeded wellbeing note.",
    });
  }

  await portfolio.save();

  const counts = {
    academic: portfolio.academic.length,
    behavior: portfolio.behavior.length,
    skills: portfolio.skills.length,
    wellbeing: portfolio.wellbeing.length,
  };

  console.log("Done. Portfolio totals:", counts);
  console.log(`GET http://localhost:5000/api/students/${studentId}/portfolio`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
