// The shop's own clock.
//
// Every date the owner and the customer read is the SHOP's date, not the
// browser's. The Order ID says so already: `01102601` is the first order of
// the 1st of October 2026 *in the shop* — the day is worked out in
// Asia/Kolkata by `public.next_order_reference()`.
//
// The admin panel's date filter did not agree with that. It built its day
// boundaries with `new Date('2026-10-19T00:00:00')`, which is midnight in
// the *browser's* time zone. An admin in London filtering "today" would get
// yesterday's orders; an admin in California would get tomorrow's. The
// filter and the Order ID would then disagree about which day an order
// belongs to — and the Order ID is the thing the customer quotes on the
// phone.
//
// India has no daylight saving, so the shop's zone is a fixed +05:30. That
// makes the day boundaries exact, and computable without a date library.

export const SHOP_TIME_ZONE = 'Asia/Kolkata'
export const SHOP_TIME_ZONE_LABEL = 'IST'

/** The shop's offset from UTC, in minutes. India observes no daylight saving. */
const SHOP_OFFSET_MINUTES = 5 * 60 + 30

/**
 * The first moment of a `yyyy-mm-dd` day in the shop's own time zone.
 *
 * Returns null for an empty or malformed value, so a half-typed date filter
 * simply does not narrow anything rather than excluding every order.
 */
export function shopDayStart(value) {
  const day = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const ms = Date.parse(`${day}T00:00:00+05:30`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The first moment of the day AFTER a `yyyy-mm-dd` day in the shop's own time
 * zone — the exclusive end of that day, so "to = 2026-10-19" still contains an
 * order placed at 23:59:59 that night.
 */
export function shopDayEndExclusive(value) {
  const start = shopDayStart(value)
  if (start === null) return null
  return start + 24 * 60 * 60 * 1000
}

/** The shop's own day (yyyy-mm-dd) for an instant — the day the Order ID uses. */
export function shopDayOf(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value ?? '').getTime()
  if (!Number.isFinite(ms)) return ''
  const shifted = new Date(ms + SHOP_OFFSET_MINUTES * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

let dateTimeFormat = null
let dateFormat = null

/** "20 Oct 2026, 2:35 pm IST" — the shop's own date and time. */
export function formatShopDateTime(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value ?? '').getTime()
  if (!Number.isFinite(ms)) return ''
  if (!dateTimeFormat) {
    dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
      timeZone: SHOP_TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
  return `${dateTimeFormat.format(new Date(ms))} ${SHOP_TIME_ZONE_LABEL}`
}

/** "20 Oct 2026" — the shop's own day. */
export function formatShopDate(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value ?? '').getTime()
  if (!Number.isFinite(ms)) return ''
  if (!dateFormat) {
    dateFormat = new Intl.DateTimeFormat('en-IN', {
      timeZone: SHOP_TIME_ZONE,
      dateStyle: 'medium',
    })
  }
  return dateFormat.format(new Date(ms))
}

/** "20 Oct 2026, 2:35 pm" in the shop's time zone, for a spreadsheet cell. */
export function shopTimestamp(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(value ?? '').getTime()
  if (!Number.isFinite(ms)) return ''
  const shifted = new Date(ms + SHOP_OFFSET_MINUTES * 60 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  )
}
