// What the shopper typed at checkout, kept on their own phone (localStorage)
// so a reload, a trip to WhatsApp or a later visit doesn't mean typing it all
// again (approved 12 Nov 2026). It stays on the device: nothing is sent
// anywhere until the shopper taps Pay. The delivery note is not kept, since
// it belongs to one order.

const KEY = 'ruhi:checkout-details'
export const REMEMBERED_FIELDS = ['phone', 'full_name', 'email', 'pincode', 'city', 'state', 'address']
const MAX_LENGTH = 300

const store = () => {
  try { return globalThis.localStorage || null } catch { return null }
}

/** The details saved on this device, as `{ field: text }`; `{}` when none (or storage is blocked). */
export function loadDetails(storage = store()) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null')
    if (!saved || typeof saved !== 'object') return {}
    const out = {}
    for (const k of REMEMBERED_FIELDS) {
      if (typeof saved[k] === 'string' && saved[k].trim()) out[k] = saved[k].slice(0, MAX_LENGTH)
    }
    return out
  } catch {
    return {}
  }
}

/** Keep what is typed (empty fields are dropped); nothing at all removes the record. */
export function saveDetails(values, storage = store()) {
  try {
    const keep = {}
    for (const k of REMEMBERED_FIELDS) {
      if (typeof values?.[k] === 'string' && values[k].trim()) keep[k] = values[k].slice(0, MAX_LENGTH)
    }
    if (Object.keys(keep).length) storage?.setItem(KEY, JSON.stringify(keep))
    else storage?.removeItem(KEY)
  } catch {
    /* private browsing or full storage: nothing is kept, checkout works as before */
  }
}
