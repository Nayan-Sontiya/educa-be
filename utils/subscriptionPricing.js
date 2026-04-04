/**
 * All amounts in INR *minor* units (paise) for Stripe (INR uses paise).
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

function stripeIntervalForPlan(plan) {
  if (plan === "monthly") return { interval: "month", interval_count: 1 };
  if (plan === "quarterly") return { interval: "month", interval_count: 3 };
  if (plan === "yearly") return { interval: "year", interval_count: 1 };
  throw new Error("Invalid plan");
}

module.exports = {
  yearlyTotalPaise,
  planAmountPaise,
  stripeIntervalForPlan,
};
