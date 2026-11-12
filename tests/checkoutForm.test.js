// Checkout form, 12 Nov 2026 (change 3 of the checkout plan): a +91 mobile
// number that only takes a real Indian mobile, details remembered on the
// shopper's phone, and PIN code → city and state from India Post's list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { INDIAN_STATES, mobileProblem, normalizeMobile, validateAddress, EMPTY_ADDRESS } from '../src/lib/checkout.js'
import { loadDetails, saveDetails } from '../src/lib/checkoutMemory.js'
import { clearPincodeCache, lookupPincode, preloadPincode } from '../src/lib/pincodes.js'
import { buildPincodes, cityName, stateName } from '../scripts/build-pincodes.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CHECKOUT = read('src/pages/Checkout.jsx')

// ---- the mobile number --------------------------------------------------------

test('pasted and autofilled numbers lose their +91, 91, 0091 or 0 and their spaces', () => {
  for (const typed of ['+91 98765 43210', '919876543210', '+91-98765-43210', '09876543210', '0091 98765 43210', '98765 43210', '98765-43210', '091 98765 43210']) {
    assert.equal(normalizeMobile(typed), '9876543210', typed)
  }
})

test('a mobile that itself starts with 91 is left alone, and nothing past 10 digits is kept', () => {
  assert.equal(normalizeMobile('9123456789'), '9123456789')
  assert.equal(normalizeMobile('+91 91234 56789'), '9123456789')
  assert.equal(normalizeMobile('98765432109'), '9876543210', 'an 11th digit is dropped')
  assert.equal(normalizeMobile(''), '')
  assert.equal(normalizeMobile(undefined), '')
})

test('typing "+91" before the number still ends with the right 10 digits', () => {
  let field = ''
  for (const key of '+919876543210') field = normalizeMobile(field + key)
  assert.equal(field, '9876543210')
  field = ''
  for (const key of '09876543210') field = normalizeMobile(field + key)
  assert.equal(field, '9876543210')
})

test('what is wrong with a number is said plainly', () => {
  assert.equal(mobileProblem(''), 'Enter your mobile number.')
  assert.equal(mobileProblem('98765'), 'Mobile numbers have 10 digits.')
  assert.equal(mobileProblem('1234567890'), 'Indian mobile numbers start with 6, 7, 8 or 9.')
  assert.equal(mobileProblem('+91 98765 43210'), '')
  assert.equal(mobileProblem('6000000000'), '')
  const ok = { ...EMPTY_ADDRESS, email: 'a@b.co', full_name: 'Priya', phone: '9876543210', address: 'Flat 12, 3rd Cross', city: 'Bengaluru', state: 'Karnataka', pincode: '560017' }
  assert.deepEqual(validateAddress(ok), {})
  assert.equal(validateAddress({ ...ok, phone: '98765' }).phone, 'Mobile numbers have 10 digits.')
  assert.equal(validateAddress({ ...ok, phone: '+1 415 555 0101' }).phone, 'Indian mobile numbers start with 6, 7, 8 or 9.')
})

test('the field shows +91, opens the number keypad and cleans what is typed', () => {
  assert.match(CHECKOUT, /prefix="\+91"/)
  assert.match(CHECKOUT, /name="phone" type="tel" inputMode="numeric" autoComplete="tel-national"/)
  assert.match(CHECKOUT, /onChange=\{onPhone\} onBlur=\{phoneLeft\}/)
  assert.match(CHECKOUT, /const phone = normalizeMobile\(e\.target\.value\)/)
  assert.match(CHECKOUT, /<span className="sr-only"> \(India, \+91\)<\/span>/)
})

// ---- remembered on the phone --------------------------------------------------

const memoryStore = () => {
  const data = new Map()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data }
}

test('typed details come back on this phone, without the delivery note', () => {
  const storage = memoryStore()
  saveDetails({ ...EMPTY_ADDRESS, phone: '9876543210', full_name: 'Priya', email: 'p@x.in', pincode: '560017', city: 'Bengaluru Urban', state: 'Karnataka', address: 'Flat 12', note: 'Ring twice' }, storage)
  assert.deepEqual(loadDetails(storage), { phone: '9876543210', full_name: 'Priya', email: 'p@x.in', pincode: '560017', city: 'Bengaluru Urban', state: 'Karnataka', address: 'Flat 12' })
  saveDetails({ ...EMPTY_ADDRESS }, storage)
  assert.equal(storage.data.size, 0, 'an empty form leaves nothing behind')
})

test('broken or blocked storage never breaks checkout', () => {
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadDetails(broken), {})
  assert.doesNotThrow(() => saveDetails({ phone: '9876543210' }, broken))
  assert.deepEqual(loadDetails(null), {})
  assert.deepEqual(loadDetails({ getItem: () => JSON.stringify({ phone: 42, email: 'a@b.co', evil: 'x' }) }), { email: 'a@b.co' })
})

test('checkout starts from what was remembered and keeps it up to date', () => {
  assert.match(CHECKOUT, /useState\(\(\) => \(\{ \.\.\.EMPTY_ADDRESS, \.\.\.loadDetails\(\) \}\)\)/)
  assert.match(CHECKOUT, /setTimeout\(\(\) => saveDetails\(f\), 400\)/)
})

// ---- PIN code → city and state ------------------------------------------------

const fixture = { '560017': 'Bengaluru Urban|Karnataka', '560001': 'Bengaluru Urban|Karnataka' }
const fakeFetch = () => {
  const calls = []
  const fetcher = async (url) => { calls.push(url); return url.endsWith('/56.json') ? { ok: true, json: async () => fixture } : { ok: false } }
  return { fetcher, calls }
}

test('a 6-digit PIN finds its city and state from one small file', async () => {
  clearPincodeCache()
  const { fetcher, calls } = fakeFetch()
  assert.deepEqual(await lookupPincode('560017', fetcher), { city: 'Bengaluru Urban', state: 'Karnataka' })
  assert.deepEqual(await lookupPincode('560001', fetcher), { city: 'Bengaluru Urban', state: 'Karnataka' })
  assert.deepEqual(calls, ['/data/pincodes/56.json'], 'one file for every 56xxxx PIN, fetched once')
  assert.equal(await lookupPincode('560099', fetcher), null, 'a PIN not in the list')
  assert.equal(await lookupPincode('56001', fetcher), null, 'not 6 digits yet')
  assert.equal(await lookupPincode('060017', fetcher), null, 'PINs never start with 0')
  assert.equal(await lookupPincode('999999', fetcher), null, 'Army Postal Service PINs are typed by hand')
})

test('the file is fetched while the PIN is typed, and a failed fetch is tried again later', async () => {
  clearPincodeCache()
  const { fetcher, calls } = fakeFetch()
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  preloadPincode('5', fetcher)
  await tick()
  assert.equal(calls.length, 0)
  preloadPincode('56', fetcher)
  await tick()
  assert.deepEqual(calls, ['/data/pincodes/56.json'])
  clearPincodeCache()
  let fail = true
  const flaky = async (url) => { calls.push(url); if (fail) throw new Error('offline'); return { ok: true, json: async () => fixture } }
  assert.equal(await lookupPincode('560017', flaky), null)
  fail = false
  assert.deepEqual(await lookupPincode('560017', flaky), { city: 'Bengaluru Urban', state: 'Karnataka' })
})

test('the page shows one line with Change, or the City and State boxes', () => {
  assert.match(CHECKOUT, /preloadPincode\(pin\)/)
  assert.match(CHECKOUT, /lookupPincode\(pin\)\.then/)
  assert.match(CHECKOUT, /const showPlaceLine = placeMode === 'auto' && place\?\.status === 'found'/)
  assert.match(CHECKOUT, /const showPlaceBoxes = !showPlaceLine && \(placeMode === 'manual' \|\| place\?\.status === 'missing'/)
  assert.match(CHECKOUT, />\s*Change\s*</)
  assert.match(CHECKOUT, /if \(found\.city \|\| found\.state\) setPlaceMode\('manual'\)/, 'a City or State to fix is always on screen')
})

test('the browser may keep the PIN files for a week', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const rule = vercel.headers.find((h) => h.source === '/data/pincodes/(.*)')
  assert.equal(rule?.headers.find((x) => x.key === 'Cache-Control')?.value, 'public, max-age=604800')
})

// ---- building the list from India Post's directory -----------------------------

test('state names are matched to the ones checkout uses', () => {
  assert.equal(stateName('KARNATAKA'), 'Karnataka')
  assert.equal(stateName('ANDAMAN & NICOBAR ISLANDS'), 'Andaman and Nicobar Islands')
  assert.equal(stateName('DADRA & NAGAR HAVELI'), 'Dadra and Nagar Haveli and Daman and Diu')
  assert.equal(stateName('THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'), 'Dadra and Nagar Haveli and Daman and Diu')
  assert.equal(stateName('JAMMU & KASHMIR'), 'Jammu and Kashmir')
  assert.equal(stateName('Pondicherry'), 'Puducherry')
  assert.equal(stateName('ORISSA'), 'Odisha')
  assert.equal(stateName('NOWHERE'), null)
  assert.equal(cityName('BENGALURU URBAN'), 'Bengaluru Urban')
  assert.equal(cityName('24 PARAGANAS NORTH'), '24 Paraganas North')
})

test('each PIN takes the district and state most of its post offices give', () => {
  const csv = [
    'circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude',
    'Karnataka Circle,Bengaluru HQ,Bengaluru East,Domlur S.O,560071,S.O,Delivery,BENGALURU URBAN,KARNATAKA,12.96,77.64',
    'Karnataka Circle,Bengaluru HQ,Bengaluru East,"HAL II Stage, H.O",560008,H.O,Delivery,BENGALURU URBAN,KARNATAKA,12.97,77.64',
    'Karnataka Circle,Bengaluru HQ,Bengaluru East,Jeevanbhimanagar S.O,560008,S.O,Delivery,BENGALURU URBAN,KARNATAKA,12.96,77.65',
    'Karnataka Circle,Bengaluru HQ,Bengaluru East,Odd B.O,560008,B.O,Delivery,BENGALURU RURAL,KARNATAKA,12.9,77.6',
    'X Circle,X,X,Somewhere,654321,B.O,Delivery,NOWHERE,ATLANTIS,0,0',
    'Tamilnadu Circle,X,X,TEST OFFICE,999999,PO,Delivery,NIZAMABAD,TELANGANA,0,0',
    'Army Postal Service,X,X,56 APO,900056,PO,Delivery,KUSHI NAGAR,UTTAR PRADESH,0,0',
  ].join('\n')
  const { pins, rows, unmatched } = buildPincodes(csv)
  assert.deepEqual(pins, { '560008': 'Bengaluru Urban|Karnataka', '560071': 'Bengaluru Urban|Karnataka' })
  assert.equal(rows, 7)
  assert.deepEqual(unmatched, { ATLANTIS: 1 })
})

test('every published PIN file is well formed', () => {
  const dir = new URL('../public/data/pincodes/', import.meta.url)
  if (!existsSync(dir)) return
  const states = new Set(INDIAN_STATES)
  for (const name of readdirSync(dir)) {
    assert.match(name, /^[1-8][0-9]\.json$/, name)
    const map = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
    for (const [pin, value] of Object.entries(map)) {
      assert.ok(pin.startsWith(name.slice(0, 2)) && /^[1-9][0-9]{5}$/.test(pin), `${name}: ${pin}`)
      const [city, state] = value.split('|')
      assert.ok(city && states.has(state), `${pin}: ${value}`)
    }
  }
})

test('text never runs under the tick', () => {
  // .cfield sits outside Tailwind's layers and would beat a plain pr-10.
  assert.match(CHECKOUT, /className=\{`cfield !pr-10 min-w-0\$\{prefix \? ' !rounded-l-none' : ''\}`\}/)
})
