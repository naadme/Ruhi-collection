// The speed check's lab runs must never count as visits in GA4 or Meta.
// 13 Nov 2026: Google's tag also sent each GA4 hit to www.google.com/g/collect,
// which the list did not block, and about 60 test visits reached the GA4 reports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../scripts/speed-check.mjs', import.meta.url), 'utf8')
const list = source.match(/const BLOCK = \[([\s\S]*?)\]/)[1]
const patterns = [...list.matchAll(/'([^']+)'/g)].map(([, glob]) =>
  new RegExp(`^${glob.split('*').map((part) => part.replace(/[.?+^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`))
const blocked = (url) => patterns.some((re) => re.test(url))
const hitCheck = new RegExp(source.match(/const TRACKING_HIT = \/(.+)\/\n/)[1])

const HITS = [
  'https://region1.google-analytics.com/g/collect?v=2&tid=G-ECY1WYFT0H&en=page_view',
  'https://www.google-analytics.com/g/collect?v=2&tid=G-ECY1WYFT0H',
  'https://analytics.google.com/g/collect?v=2&tid=G-ECY1WYFT0H',
  'https://www.google.com/g/collect?v=2&tid=G-ECY1WYFT0H&en=page_view',
  'https://stats.g.doubleclick.net/g/collect?v=2&tid=G-ECY1WYFT0H',
  'https://www.google.com/ccm/collect?en=page_view',
  'https://www.facebook.com/tr/?id=2088410345195562&ev=PageView',
  'https://www.facebook.com/privacy_sandbox/pixel/register/trigger/?id=2088410345195562',
  'https://www.ruhi-collections.com/_vercel/insights/view',
]
const SCRIPTS = [
  'https://www.googletagmanager.com/gtm.js?id=GTM-K6SNCLPC',
  'https://www.googletagmanager.com/gtag/js?id=G-ECY1WYFT0H&cx=c',
  'https://connect.facebook.net/en_US/fbevents.js',
  'https://connect.facebook.net/signals/config/2088410345195562?v=2.9.439',
]

test('every known GA4, Meta and Vercel hit address is blocked in lab runs', () => {
  for (const url of HITS) assert.ok(blocked(url), `not blocked: ${url}`)
})

test('the tracking scripts themselves still load, so their cost is measured', () => {
  for (const url of SCRIPTS) assert.equal(blocked(url), false, `blocked by mistake: ${url}`)
})

test('a hit that gets through anyway is recognised, and the run stops', () => {
  for (const url of HITS) assert.ok(hitCheck.test(url), `not recognised: ${url}`)
  for (const url of SCRIPTS) assert.equal(hitCheck.test(url), false, `script mistaken for a hit: ${url}`)
  assert.match(source, /if \(leaked\.length\) \{\s*throw new Error/)
})
