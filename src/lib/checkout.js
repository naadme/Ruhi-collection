// Field rules and formatting shared by the checkout form.
// The database enforces the same limits (see the check constraints on
// `public.orders`) — these exist so the shopper is told *before* submitting.

export const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())

// `public.order_items.qty` is `check (qty between 1 and 10)` and
// `create_order()` rejects anything outside that range, so the cart must clamp
// too — otherwise a shopper can build a basket the server will always refuse.
export const MAX_QTY = 10

// How many distinct lines one order may carry.
//
// `create-razorpay-order`'s `readItems()` accepts 1..20 items and returns null
// outside that, which the caller answers with "Your cart is empty." — a baffling
// message for a shopper looking at 21 products. Stating the limit here, before
// the request, keeps the two in step and tells them what to actually do.
// `qty` is per line, so this counts lines, not units.
export const MAX_CART_LINES = 20

export const phoneDigits = (v) => String(v ?? '').replace(/\D/g, '')

// The mobile number as checkout keeps it: the 10 digits of an Indian mobile.
// Checkout shows +91 in front of the field (12 Nov 2026), so a number typed,
// pasted or autofilled with "+91", "91", "0091" or a leading 0 has that
// stripped, along with spaces and dashes: "+91 98765 43210", "919876543210"
// and "09876543210" all become 9876543210. A prefix is only stripped once the
// number runs past 10 digits, so a mobile that itself starts with 91 is left
// alone. Nothing past 10 digits is kept, so the field takes at most 10.
const MOBILE_PREFIXES = ['0091', '91', '0']
export function normalizeMobile(value) {
  let d = phoneDigits(value)
  let prefix
  while (d.length > 10 && (prefix = MOBILE_PREFIXES.find((p) => d.startsWith(p)))) d = d.slice(prefix.length)
  return d.slice(0, 10)
}

/** What is wrong with a mobile number as typed, or '' when it is a valid Indian mobile. */
export function mobileProblem(value) {
  const d = normalizeMobile(value)
  if (!d) return 'Enter your mobile number.'
  if (d.length < 10) return 'Mobile numbers have 10 digits.'
  if (!/^[6-9]/.test(d)) return 'Indian mobile numbers start with 6, 7, 8 or 9.'
  return ''
}

/** An Indian mobile number: 10 digits starting with 6, 7, 8 or 9. */
export const mobileOk = (v) => mobileProblem(v) === ''

export const pincodeOk = (v) => /^[1-9][0-9]{5}$/.test(v.trim())

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

export const EMPTY_ADDRESS = {
  email: '', full_name: '', phone: '',
  address: '', city: '', state: '', pincode: '', note: '',
}

/** Returns `{ field: message }` for every problem found — empty object when valid. */
export function validateAddress(values) {
  const errors = {}
  if (!emailOk(values.email)) errors.email = 'Enter a valid email address.'
  if (values.full_name.trim().length < 2) errors.full_name = 'Enter your full name.'
  const mobile = mobileProblem(values.phone)
  if (mobile) errors.phone = mobile
  if (values.address.trim().length < 5) errors.address = 'Enter your street address.'
  if (values.city.trim().length < 2) errors.city = 'Enter your city.'
  if (values.state.trim().length < 2) errors.state = 'Enter your state.'
  if (!pincodeOk(values.pincode)) errors.pincode = 'Enter a valid 6-digit PIN code.'
  if (values.note.length > 500) errors.note = 'Keep the note under 500 characters.'
  return errors
}
