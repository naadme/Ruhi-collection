// Field rules and formatting shared by the checkout form.
// The database enforces the same limits (see the check constraints on
// `public.orders`) — these exist so the shopper is told *before* submitting.

export const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())

// `public.order_items.qty` is `check (qty between 1 and 10)` and
// `create_order()` rejects anything outside that range, so the cart must clamp
// too — otherwise a shopper can build a basket the server will always refuse.
export const MAX_QTY = 10

// Accepts 9876543210, +91 98765 43210, 98765-43210 … but must contain
// between 10 and 15 digits once formatting is stripped.
export const phoneDigits = (v) => v.replace(/\D/g, '')
export const phoneOk = (v) => {
  const d = phoneDigits(v)
  return d.length >= 10 && d.length <= 15
}

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
  if (!phoneOk(values.phone)) errors.phone = 'Enter a valid phone number (10–15 digits).'
  if (values.address.trim().length < 5) errors.address = 'Enter your street address.'
  if (values.city.trim().length < 2) errors.city = 'Enter your city.'
  if (values.state.trim().length < 2) errors.state = 'Enter your state.'
  if (!pincodeOk(values.pincode)) errors.pincode = 'Enter a valid 6-digit PIN code.'
  if (values.note.length > 500) errors.note = 'Keep the note under 500 characters.'
  return errors
}
