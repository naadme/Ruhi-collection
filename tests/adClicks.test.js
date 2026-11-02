// Ad click IDs and campaign tags, kept until the order can carry them
// (tracking brief, Section 4, steps 1–4, and Meta's guide to fbc and fbp).

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  afterLanding,
  cookieDomain,
  current,
  decodeSaved,
  encodeSaved,
  fbcToSet,
  formatFbc,
  landingFrom,
  orderAttribution,
} from '../src/lib/adClicks.js'

const DAY = 86_400_000
const oct15 = Date.parse('2026-10-15T09:00:00Z')
const oct18 = Date.parse('2026-10-18T09:02:00Z')

test('a direct visit carries nothing and changes nothing', () => {
  assert.equal(landingFrom('https://www.ruhi-collections.com/', oct18), null)
  assert.equal(landingFrom('https://www.ruhi-collections.com/shop?type=dress&sort=low', oct18), null)
  assert.equal(landingFrom('not a url', oct18), null)
  const saved = { gclid: 'Cj0KCQ', gclid_at: oct15 }
  assert.deepEqual(afterLanding(saved, null, '', oct18), saved)
})

test('values are stored exactly as received — click IDs are case sensitive', () => {
  const landing = landingFrom('https://www.ruhi-collections.com/product/x?utm_source=Google&gclid=Cj0KCQjw-AbC_dE', oct18)
  assert.equal(landing.utm.utm_source, 'Google')
  assert.equal(landing.clicks.gclid, 'Cj0KCQjw-AbC_dE')
  assert.equal(landing.landing_time, '2026-10-18T09:02:00.000Z')
})

test('the brief’s example: a Meta click on 15 Oct, a Google click on 18 Oct, both kept', () => {
  const meta = landingFrom('https://www.ruhi-collections.com/?utm_source=facebook&utm_medium=paid_social&fbclid=IwAR2xK9', oct15)
  const afterMeta = afterLanding({}, meta, fbcToSet(meta.fbclid, '', oct15), oct15)
  const google = landingFrom('https://www.ruhi-collections.com/product/floral?utm_source=google&utm_medium=cpc&utm_campaign=diwali_sale_2026&utm_term=anarkali%20kurta&gclid=Cj0KCQjwBwE', oct18)
  const saved = afterLanding(afterMeta, google, '', oct18)
  assert.deepEqual(orderAttribution(saved, {}, oct18 + DAY), {
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'diwali_sale_2026',
    utm_term: 'anarkali kurta',
    gclid: 'Cj0KCQjwBwE',
    fbc: `fb.1.${oct15}.IwAR2xK9`,
    landing_page: 'https://www.ruhi-collections.com/product/floral?utm_source=google&utm_medium=cpc&utm_campaign=diwali_sale_2026&utm_term=anarkali%20kurta&gclid=Cj0KCQjwBwE',
    landing_time: '2026-10-18T09:02:00.000Z',
  })
})

test('the campaign tags describe the latest ad visit as one set, never a mix of two', () => {
  const first = afterLanding({}, landingFrom('https://x.com/?utm_source=google&utm_content=kurta_video_1&gclid=G1', oct15), '', oct15)
  const second = afterLanding(first, landingFrom('https://x.com/?utm_source=newsletter', oct18), '', oct18)
  assert.equal(second.utm_source, 'newsletter')
  assert.equal(second.utm_content, undefined)
  assert.equal(second.gclid, 'G1')
})

test('Meta’s _fbc is set only when missing or for another fbclid (Meta’s two cases)', () => {
  assert.equal(fbcToSet('IwAR2xK9', '', oct15), `fb.1.${oct15}.IwAR2xK9`)
  assert.equal(fbcToSet('IwAR2xK9', `fb.1.${oct15}.IwAR2xK9`, oct18), null)
  assert.equal(fbcToSet('IwAR2xK9', `fb.1.${oct15}.IwAR2xK9.AQ`, oct18), null)
  assert.equal(fbcToSet('NewClick', `fb.1.${oct15}.IwAR2xK9`, oct18), `fb.1.${oct18}.NewClick`)
  assert.equal(fbcToSet('', '', oct18), null)
  assert.equal(formatFbc('AbC', 1792038600000), 'fb.1.1792038600000.AbC')
})

test('the same click arriving again keeps the time it first arrived', () => {
  const once = afterLanding({}, landingFrom('https://x.com/?gclid=G1', oct15), '', oct15)
  const again = afterLanding(once, landingFrom('https://x.com/?gclid=G1', oct18), '', oct18)
  assert.equal(again.gclid_at, oct15)
  const meta = afterLanding({}, landingFrom('https://x.com/?fbclid=F1', oct15), `fb.1.${oct15}.F1`, oct15)
  assert.equal(meta.fbc_at, oct15)
})

test('everything lapses 90 days after it arrived', () => {
  const saved = afterLanding({}, landingFrom('https://x.com/?utm_source=google&gclid=G1', oct15), '', oct15)
  assert.equal(current(saved, oct15 + 89 * DAY).gclid, 'G1')
  assert.deepEqual(current(saved, oct15 + 90 * DAY), {})
  // A later Meta click does not extend the Google click's 90 days.
  const later = afterLanding(saved, landingFrom('https://x.com/?fbclid=F1', oct15 + 60 * DAY), `fb.1.${oct15 + 60 * DAY}.F1`, oct15 + 60 * DAY)
  const kept = current(later, oct15 + 95 * DAY)
  assert.equal(kept.gclid, undefined)
  assert.equal(kept.fbc, `fb.1.${oct15 + 60 * DAY}.F1`)
})

test('the order takes the live Meta cookies, which the pixel keeps current', () => {
  const saved = afterLanding({}, landingFrom('https://x.com/?fbclid=Old', oct15), `fb.1.${oct15}.Old`, oct15)
  const out = orderAttribution(saved, { fbc: `fb.1.${oct18}.New`, fbp: 'fb.1.1596403881668.1116446470' }, oct18)
  assert.equal(out.fbc, `fb.1.${oct18}.New`)
  assert.equal(out.fbp, 'fb.1.1596403881668.1116446470')
  // Nothing known, nothing sent — never "undefined" or "NA".
  assert.deepEqual(orderAttribution({}, {}, oct18), {})
})

test('a long landing page is cut to 2,000 characters, and to whatever still fits a cookie', () => {
  const long = `https://x.com/?gclid=G1&q=${'a'.repeat(5000)}`
  assert.equal(landingFrom(long, oct18).landing_page.length, 2000)
  const saved = afterLanding({}, landingFrom(`https://x.com/?gclid=G1&q=${'%E2%82%B9'.repeat(400)}`, oct18), '', oct18)
  const value = encodeSaved(saved)
  assert.ok(value.length > 0 && value.length <= 3800)
  const back = decodeSaved(value)
  assert.equal(back.gclid, 'G1')
  assert.ok(saved.landing_page.startsWith(back.landing_page.slice(0, 20)))
})

test('a damaged cookie reads as nothing saved', () => {
  assert.deepEqual(decodeSaved('%E0%A4%A'), {})
  assert.deepEqual(decodeSaved('[1,2]'), {})
  assert.deepEqual(decodeSaved(''), {})
})

test('the cookie is shared by www and the bare domain; localhost keeps its own', () => {
  assert.equal(cookieDomain('www.ruhi-collections.com'), '.ruhi-collections.com')
  assert.equal(cookieDomain('ruhi-collections.com'), '.ruhi-collections.com')
  assert.equal(cookieDomain('localhost'), '')
  assert.equal(cookieDomain('127.0.0.1'), '')
})
