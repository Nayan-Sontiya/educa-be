/**
 * All amounts in INR *minor* units (paise) for Razorpay (INR uses paise).
 * ₹1 = 100 paise.
 */

function yearlyTotalPaise(studentCount, pricePerStudentYearInr) {
  const rupees = pricePerStudentYearInr * studentCount;
  return Math.round(rupees * 100);
}

function planAmountPaise(plan, studentCount, pricePerStudentYearInr) {
  const yearly = yearlyTotalPaise(studentCount, pricePerStudentYearInr);
  if (plan === "monthly") return Math.round(yearly / 12);
  if (plan === "quarterly") return Math.round(yearly / 4);
  if (plan === "yearly") return yearly;
  throw new Error("Invalid plan");
}

/** Razorpay plan API: period + interval (count). */
function razorpayIntervalForPlan(plan) {
  if (plan === "monthly") return { period: "monthly", interval: 1 };
  if (plan === "quarterly") return { period: "monthly", interval: 3 };
  if (plan === "yearly") return { period: "yearly", interval: 1 };
  throw new Error("Invalid plan");
}

module.exports = {
  yearlyTotalPaise,
  planAmountPaise,
  razorpayIntervalForPlan,
};
