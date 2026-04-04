const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RATING_SCORE = { good: 3, average: 2, needs_attention: 1 };
const STATUS_SCORE = { happy_engaged: 3, neutral: 2, low_withdrawn: 1 };
const RISK_TAGS = ["quiet", "isolated", "sad", "angry", "not_participating", "low_energy", "disturbed"];

/**
 * Get ISO week number from a date.
 */
const getWeekNumber = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

/**
 * Get the Monday (start) of the ISO week for a given date.
 */
const getWeekStart = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() - (day - 1));
  return d;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Format a date range label for a week: "Apr 1–7"
 */
const weekDateLabel = (date) => {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sm = MONTHS[start.getMonth()];
  const em = MONTHS[end.getMonth()];
  if (sm === em) return `${sm} ${start.getDate()}–${end.getDate()}`;
  return `${sm} ${start.getDate()}–${em} ${end.getDate()}`;
};

/**
 * Group academic entries by week, compute weekly percentage.
 * Stores the earliest date seen for each week so we can generate a date label.
 */
const computeAcademicWeeklyScores = (academic = []) => {
  const byWeek = {};
  academic.forEach((rec) => {
    const recDate = rec.date || new Date();
    const week = rec.weekNumber || getWeekNumber(recDate);
    if (!byWeek[week]) byWeek[week] = { total: 0, obtained: 0, count: 0, date: recDate };
    if (typeof rec.marksObtained === "number" && typeof rec.maxMarks === "number" && rec.maxMarks > 0) {
      byWeek[week].obtained += rec.marksObtained;
      byWeek[week].total += rec.maxMarks;
      byWeek[week].count++;
    }
  });
  return Object.entries(byWeek)
    .map(([week, val]) => ({
      week: Number(week),
      dateLabel: weekDateLabel(val.date),
      percentage: val.total > 0 ? Math.round((val.obtained / val.total) * 100) : null,
      assessments: val.count,
    }))
    .sort((a, b) => a.week - b.week);
};

/**
 * Compute weekly behavior score (avg of rated fields, 1–3 scale → percentage).
 */
const computeBehaviorWeeklyScores = (behavior = []) => {
  const byWeek = {};
  behavior.forEach((rec) => {
    const recDate = rec.date || new Date();
    const week = rec.weekNumber || getWeekNumber(recDate);
    if (!byWeek[week]) byWeek[week] = { scores: [], date: recDate };
    const fields = [rec.discipline, rec.respect, rec.attention, rec.interaction, rec.participation, rec.socialInteraction];
    const rated = fields.filter((f) => f && RATING_SCORE[f] !== undefined);
    if (rated.length) {
      const avg = rated.reduce((sum, f) => sum + RATING_SCORE[f], 0) / rated.length;
      byWeek[week].scores.push(avg);
    }
  });
  return Object.entries(byWeek)
    .map(([week, val]) => ({
      week: Number(week),
      dateLabel: weekDateLabel(val.date),
      score: val.scores.length
        ? Math.round((val.scores.reduce((a, b) => a + b, 0) / val.scores.length / 3) * 100)
        : null,
    }))
    .sort((a, b) => a.week - b.week);
};

/**
 * Compute weekly skill score.
 */
const computeSkillWeeklyScores = (skills = []) => {
  const byWeek = {};
  skills.forEach((rec) => {
    const recDate = rec.date || new Date();
    const week = rec.weekNumber || getWeekNumber(recDate);
    if (!byWeek[week]) byWeek[week] = { scores: [], date: recDate };
    if (rec.ratingLabel && RATING_SCORE[rec.ratingLabel] !== undefined) {
      byWeek[week].scores.push(RATING_SCORE[rec.ratingLabel]);
    } else if (typeof rec.rating === "number") {
      byWeek[week].scores.push((rec.rating / 5) * 3);
    }
  });
  return Object.entries(byWeek)
    .map(([week, val]) => ({
      week: Number(week),
      dateLabel: weekDateLabel(val.date),
      score: val.scores.length
        ? Math.round((val.scores.reduce((a, b) => a + b, 0) / val.scores.length / 3) * 100)
        : null,
    }))
    .sort((a, b) => a.week - b.week);
};

/**
 * Detect emotional risk: 3+ consecutive weeks of low_withdrawn OR repeated risk tags.
 */
const detectEmotionalRisk = (wellbeing = []) => {
  const sorted = [...wellbeing].sort((a, b) => {
    const wa = a.weekNumber || getWeekNumber(a.date || new Date());
    const wb = b.weekNumber || getWeekNumber(b.date || new Date());
    return wa - wb;
  });

  const recentLow = sorted.slice(-3).filter((w) => w.status === "low_withdrawn").length;
  const allTags = sorted.flatMap((w) => w.tags || []);
  const riskTagCount = allTags.filter((t) => RISK_TAGS.includes(t)).length;

  return {
    isAtRisk: recentLow >= 3 || riskTagCount >= 5,
    consecutiveLowWeeks: recentLow,
    riskTagCount,
    recentStatus: sorted.slice(-1)[0]?.status || null,
  };
};

/**
 * Detect trend (improving / declining / stable) from a weekly score array.
 */
const detectTrend = (weeklyScores) => {
  const valid = weeklyScores.filter((w) => w.percentage !== null || w.score !== null);
  if (valid.length < 2) return "stable";
  const values = valid.map((w) => w.percentage ?? w.score ?? 0);
  const first = values.slice(0, Math.ceil(values.length / 2));
  const last = values.slice(Math.floor(values.length / 2));
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
  if (avgLast - avgFirst > 5) return "improving";
  if (avgFirst - avgLast > 5) return "declining";
  return "stable";
};

/**
 * Build holistic score from academic, behavior, skill averages.
 */
const computeHolisticScore = (academicWeekly, behaviorWeekly, skillWeekly) => {
  const avg = (arr) => {
    const valid = arr.filter((v) => v !== null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  };
  const academic = avg(academicWeekly.map((w) => w.percentage));
  const behavior = avg(behaviorWeekly.map((w) => w.score));
  const skill = avg(skillWeekly.map((w) => w.score));

  const parts = [academic, behavior, skill].filter((v) => v !== null);
  const overall = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  return { academic, behavior, skill, overall };
};

/**
 * Main function: analyze portfolio data and generate AI insights.
 */
const analyzePortfolio = async (portfolio, studentName = "the student") => {
  const academicWeekly = computeAcademicWeeklyScores(portfolio.academic);
  const behaviorWeekly = computeBehaviorWeeklyScores(portfolio.behavior);
  const skillWeekly = computeSkillWeeklyScores(portfolio.skills);
  const emotionalRisk = detectEmotionalRisk(portfolio.wellbeing || []);
  const holisticScore = computeHolisticScore(academicWeekly, behaviorWeekly, skillWeekly);

  const academicTrend = detectTrend(academicWeekly);
  const behaviorTrend = detectTrend(behaviorWeekly);
  const skillTrend = detectTrend(skillWeekly);

  // Build a summary for GPT
  const summaryText = `
Student: ${studentName}

Academic weekly scores: ${JSON.stringify(academicWeekly)}
Behavior weekly scores: ${JSON.stringify(behaviorWeekly)}
Skill weekly scores: ${JSON.stringify(skillWeekly)}
Emotional wellbeing: ${JSON.stringify((portfolio.wellbeing || []).map((w) => ({ status: w.status, tags: w.tags, week: w.weekNumber })))}

Holistic Score: Academic ${holisticScore.academic ?? "N/A"}%, Behavior ${holisticScore.behavior ?? "N/A"}%, Skills ${holisticScore.skill ?? "N/A"}%, Overall ${holisticScore.overall ?? "N/A"}%
Academic trend: ${academicTrend}
Behavior trend: ${behaviorTrend}
Skill trend: ${skillTrend}
Emotional risk: ${JSON.stringify(emotionalRisk)}
  `.trim();

  let aiInsights = [];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a school counselor AI. Given student portfolio data, generate 3-5 short, actionable, empathetic insight bullets for teachers and parents. Each bullet should be 1-2 sentences. Be specific and positive where possible. Return a JSON array of strings only.",
        },
        { role: "user", content: summaryText },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    aiInsights = Array.isArray(parsed.insights) ? parsed.insights : Object.values(parsed)[0] || [];
  } catch (err) {
    console.error("OpenAI analysis error:", err.message);
    aiInsights = generateFallbackInsights(academicTrend, behaviorTrend, skillTrend, emotionalRisk);
  }

  return {
    academicWeekly,
    behaviorWeekly,
    skillWeekly,
    holisticScore,
    trends: { academic: academicTrend, behavior: behaviorTrend, skill: skillTrend },
    emotionalRisk,
    aiInsights,
  };
};

const generateFallbackInsights = (academicTrend, behaviorTrend, skillTrend, emotionalRisk) => {
  const insights = [];
  if (academicTrend === "improving") insights.push("Academic performance is on an upward trend — keep encouraging consistent study habits.");
  else if (academicTrend === "declining") insights.push("Academic scores have been declining recently. Consider scheduling a one-on-one review session.");
  else insights.push("Academic performance has been stable. Look for opportunities to challenge and stretch learning.");

  if (behaviorTrend === "improving") insights.push("Classroom behavior and engagement are improving — positive reinforcement is working well.");
  else if (behaviorTrend === "declining") insights.push("Behavior indicators need attention. A brief check-in with the student may help.");

  if (skillTrend === "improving") insights.push("Skill development is progressing well. Continue with collaborative activities.");
  else if (skillTrend === "declining") insights.push("Skill scores show a slight dip. Focus on communication and teamwork exercises.");

  if (emotionalRisk.isAtRisk) insights.push("Emotional wellbeing indicators suggest this student may benefit from additional support. A counselor check-in is recommended.");
  else insights.push("Emotional wellbeing appears healthy. Continue fostering a positive and inclusive classroom environment.");

  return insights;
};

module.exports = { analyzePortfolio, computeAcademicWeeklyScores, computeBehaviorWeeklyScores, computeSkillWeeklyScores, detectEmotionalRisk, computeHolisticScore, detectTrend, getWeekNumber };
