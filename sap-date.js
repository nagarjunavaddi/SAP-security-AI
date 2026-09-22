// lib/sap-date.js  [IK-SAP-DATE]
// Converts UI date strings to SAP DATS format (yyyymmdd).
// Additive helper -- no existing file touched.
// Accepts: "2026-09-19", "2026/09/19", "20260919", Date object, null/''.
// Returns: "yyyymmdd" string, or '' if input is empty/invalid.
function toSapDate(v) {
  if (v === null || v === undefined || v === '') return '';
  // Date object
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  // Already yyyymmdd
  if (/^\d{8}$/.test(s)) return s;
  // yyyy-mm-dd or yyyy/mm/dd (optionally with time after 'T' or space)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  }
  // Fallback: let Date parse it (ISO strings etc.)
  const d = new Date(s);
  if (!isNaN(d)) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}${mo}${da}`;
  }
  return '';
}
module.exports = { toSapDate };
