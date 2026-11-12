// The delivery promise at checkout, as dates instead of "7-10 working days",
// so the shopper knows when to expect the parcel.
//
// The owner's rule (12 Nov 2026): the window opens 7 working days after the
// order, counting Monday to Saturday, and stays open for 7 days. An order on
// Thursday 12 Nov arrives "Fri 20 – Fri 27 Nov". Days are counted in India,
// whatever time zone the shopper's phone is set to.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Working days (Mon–Sat) from the order to the first day of the window. */
export const WORKING_DAYS_TO_FIRST = 7
/** Calendar days from the first day of the window to the last. */
export const WINDOW_DAYS = 7

/** The date in India at `now`, as a UTC-midnight Date (read only its UTC fields). */
function indiaDate(now) {
  const t = new Date(now.getTime() + IST_OFFSET_MS)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}

/** `{ first, last }`: the window for an order placed at `now`, as UTC-midnight Dates. */
export function deliveryWindow(now = new Date()) {
  let day = indiaDate(now)
  let counted = 0
  while (counted < WORKING_DAYS_TO_FIRST) {
    day = new Date(day.getTime() + DAY_MS)
    if (day.getUTCDay() !== 0) counted += 1
  }
  return { first: day, last: new Date(day.getTime() + WINDOW_DAYS * DAY_MS) }
}

const dayText = (d, withMonth) =>
  `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}${withMonth ? ` ${MONTHS[d.getUTCMonth()]}` : ''}`

/** "Fri 20 – Fri 27 Nov", or "Sat 28 Nov – Sat 5 Dec" when the window crosses a month. */
export function deliveryWindowText(now = new Date()) {
  const { first, last } = deliveryWindow(now)
  const sameMonth = first.getUTCMonth() === last.getUTCMonth()
  return `${dayText(first, !sameMonth)} – ${dayText(last, true)}`
}
