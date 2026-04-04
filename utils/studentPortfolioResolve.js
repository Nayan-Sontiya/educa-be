const StudentPortfolio = require("../models/StudentPortfolio");

const portfolioEntryCount = (p) =>
  (p.academic?.length || 0) +
  (p.behavior?.length || 0) +
  (p.skills?.length || 0) +
  (p.wellbeing?.length || 0);

/**
 * One canonical portfolio per student. Merges duplicate docs (identity-only vs studentId-only)
 * so reads/writes and seed scripts all see the same data.
 */
async function resolvePortfolioForStudent(student, studentIdentityId) {
  const oid = student._id;
  const iid = studentIdentityId || student.studentIdentityId;

  const or = [{ studentId: oid }];
  if (iid) or.push({ studentIdentityId: iid });

  const docs = await StudentPortfolio.find({ $or: or });

  if (docs.length === 0) {
    return StudentPortfolio.create({
      studentId: oid,
      studentIdentityId: iid || undefined,
    });
  }

  if (docs.length === 1) {
    const p = docs[0];
    let save = false;
    if (!p.studentId || p.studentId.toString() !== oid.toString()) {
      p.studentId = oid;
      save = true;
    }
    if (iid && (!p.studentIdentityId || p.studentIdentityId.toString() !== iid.toString())) {
      p.studentIdentityId = iid;
      save = true;
    }
    if (save) await p.save();
    return p;
  }

  docs.sort((a, b) => portfolioEntryCount(b) - portfolioEntryCount(a));
  const primary = docs[0];
  for (let i = 1; i < docs.length; i++) {
    const other = docs[i];
    if (other.academic?.length) primary.academic.push(...other.academic);
    if (other.behavior?.length) primary.behavior.push(...other.behavior);
    if (other.skills?.length) primary.skills.push(...other.skills);
    if (other.wellbeing?.length) primary.wellbeing.push(...other.wellbeing);
    await StudentPortfolio.deleteOne({ _id: other._id });
  }
  primary.studentId = oid;
  if (iid) primary.studentIdentityId = iid;
  await primary.save();
  return primary;
}

module.exports = { resolvePortfolioForStudent, portfolioEntryCount };
