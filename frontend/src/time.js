// SQLite CURRENT_TIMESTAMP is UTC without a zone suffix ("2026-10-02 04:55:12");
// new Date() on that string would read it as local time.
export function parseDbTime(ts) {
  if (typeof ts !== 'string' || /[zZ]|[+-]\d\d:?\d\d$/.test(ts)) return new Date(ts).getTime()
  return new Date(ts.replace(' ', 'T') + 'Z').getTime()
}

export function formatDbTime(ts, options) {
  if (!ts) return '—'
  return new Date(parseDbTime(ts)).toLocaleString([], options)
}

// A local calendar date from <input type="date"> ("2026-10-02") -> the UTC
// "YYYY-MM-DD HH:MM:SS" string the database compares against.
// endOfDay picks 23:59:59 local instead of 00:00:00.
export function localDateToDb(date, endOfDay = false) {
  if (!date) return undefined
  const local = new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  return local.toISOString().slice(0, 19).replace('T', ' ')
}
