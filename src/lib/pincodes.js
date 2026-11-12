// PIN code → city and state at checkout, from India Post's All India Pincode
// Directory (Department of Posts, data.gov.in, Government Open Data Licence).
//
// The list is published on the shop's own domain as small files, one per
// first two digits of the PIN (public/data/pincodes/56.json holds every
// 56xxxx PIN), built by scripts/build-pincodes.mjs. Checkout fetches only the
// file for the PIN being typed, about 2 KB, from the site's own CDN. It asks
// no database and no outside service, and adds nothing to the shop's script.
// Each file maps a PIN to "City|State", the state written as in INDIAN_STATES.
// Only street-address PINs are listed (first digit 1–8); a PIN starting with
// 9 (Army Postal Service) gets the City and State boxes straight away.

export const PINCODE_DATA_PATH = '/data/pincodes'

const files = new Map() // first two digits → Promise<{ [pin]: 'City|State' } | null>

function file(prefix, fetcher) {
  if (!files.has(prefix)) {
    const loading = Promise.resolve()
      .then(() => fetcher(`${PINCODE_DATA_PATH}/${prefix}.json`))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => (data && typeof data === 'object' && !Array.isArray(data) ? data : null))
      .catch(() => null)
    // A failed fetch is forgotten, so the next PIN typed tries again.
    loading.then((data) => { if (!data) files.delete(prefix) })
    files.set(prefix, loading)
  }
  return files.get(prefix)
}

/**
 * Start fetching the file for a PIN being typed (from its second digit), so
 * the city and state are ready the moment the sixth digit goes in.
 */
export function preloadPincode(pin, fetcher = globalThis.fetch) {
  const digits = String(pin ?? '').replace(/\D/g, '')
  if (digits.length >= 2 && /^[1-8]/.test(digits) && typeof fetcher === 'function') file(digits.slice(0, 2), fetcher)
}

/** `{ city, state }` for a 6-digit PIN code, or null when it is not in the list (or the list can't be reached). */
export async function lookupPincode(pin, fetcher = globalThis.fetch) {
  const digits = String(pin ?? '').trim()
  if (!/^[1-8][0-9]{5}$/.test(digits) || typeof fetcher !== 'function') return null
  const data = await file(digits.slice(0, 2), fetcher)
  const entry = typeof data?.[digits] === 'string' ? data[digits] : ''
  const [city, state] = entry.split('|')
  return city && state ? { city, state } : null
}

/** For tests: forget the files fetched so far. */
export function clearPincodeCache() {
  files.clear()
}
