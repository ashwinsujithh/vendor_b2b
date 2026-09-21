/** Date helpers for subscription windows (local-calendar based). */

/** 'YYYY-MM-DD' for today (local time). */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Add n calendar days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'. */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Add one calendar month to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'.
 * Same day next month; clamps to the month's last day when the source day
 * doesn't exist (e.g. Jan 31 → Feb 28).
 */
function addMonths(dateStr) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const targetMonthIndex = m; // 0-based index of the NEXT month
  const targetYear = m === 12 ? y + 1 : y;
  const lastDay = new Date(targetYear, targetMonthIndex, 0).getDate();
  const d = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

module.exports = { todayStr, addDays, addMonths };
