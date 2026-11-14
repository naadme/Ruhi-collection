// The speed check's lab runs must never count as visits in GA4 or Meta.
// 13 Nov 2026: Google's tag also sent each GA4 hit to www.google.com/g/collect,
// which the list did not block, and about 60 test visits reached the GA4 reports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkSettings, mergeBaseline } from '../scripts/speedSettings.mjs'

const source = readFileSync(new URL('../scripts/speed-check.mjs', import.meta.url), 'utf8')
const budget = JSON.parse(readFileSync(new URL('../speed-budget.json', import.meta.url), 'utf8'))
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

// The live site also runs the Meta pixel, which local builds never load, so the live
// check has its own runs, limits and baseline (14 Nov 2026).
test('the live check has its own runs and limits, and compares live with live', () => {
  assert.ok(budget.live.runs >= 5, 'live TBT swings from run to run; take the median of at least 5')
  assert.equal(budget.live.max.tbtMs, 300)
  assert.equal(budget.live.max.lcpMs, 9000, 'the product page was 9.1 s live before the 14 Nov release')
  assert.equal(budget.live.regressionToleranceMs, 1500, 'live LCP swung by up to 2.6 s between 5-run rounds')
  for (const key of ['lcpMs', 'fcpMs', 'tbtMs', 'cls']) assert.equal(typeof budget.live.max[key], 'number', key)

  const saved = { lab: { product: { lcpMs: 6087 } }, live: { measuredAt: '2026-11-14', product: { lcpMs: 5928 } } }
  const live = checkSettings(budget, saved, true)
  assert.equal(live.mode, 'live')
  assert.equal(live.runs, budget.live.runs)
  assert.equal(live.max.tbtMs, 300)
  assert.equal(live.prior.product.lcpMs, 5928, 'compared with the live baseline, never the lab one')
  assert.deepEqual(live.pages, budget.lab.pages)
  assert.equal(live.max.lcpMs, 9000)
  assert.equal(live.toleranceMs, 1500)

  const lab = checkSettings(budget, saved, false)
  assert.equal(lab.mode, 'lab')
  assert.equal(lab.runs, budget.lab.runs)
  assert.equal(lab.max.tbtMs, budget.lab.max.tbtMs)
  assert.equal(lab.max.lcpMs, budget.lab.max.lcpMs, 'the lab keeps its own, tighter lines')
  assert.equal(lab.toleranceMs, budget.lab.regressionToleranceMs)
  assert.equal(lab.prior.product.lcpMs, 6087)

  assert.equal(checkSettings(budget, null, true).prior, null, 'no live baseline yet: nothing to compare with')
})

test('saving a live baseline changes only the live numbers, and a lab save keeps them', () => {
  const old = { measuredAt: 'lab day', files: { html: 2.4 }, chunks: { Checkout: 11.5 }, lab: { product: { lcpMs: 6087 }, home: { lcpMs: 5785 } } }
  const afterLive = mergeBaseline(old, { measuredAt: 'live day', live: { product: { lcpMs: 5928 } } }, true)
  assert.deepEqual(afterLive.files, old.files)
  assert.deepEqual(afterLive.chunks, old.chunks)
  assert.deepEqual(afterLive.lab, old.lab)
  assert.equal(afterLive.measuredAt, 'lab day')
  assert.deepEqual(afterLive.live, { measuredAt: 'live day', product: { lcpMs: 5928 } })

  const afterLab = mergeBaseline(afterLive, { measuredAt: 'next day', files: { html: 2.5 }, chunks: { Checkout: 11.4 }, lab: { product: { lcpMs: 6000 } } }, false)
  assert.deepEqual(afterLab.live, afterLive.live, 'a lab save keeps the live numbers')
  assert.equal(afterLab.lab.product.lcpMs, 6000)
  assert.equal(afterLab.lab.home.lcpMs, 5785, 'a page the save did not measure stays')
  assert.equal(afterLab.files.html, 2.5)
})

test('the speed check takes its limits and baseline from speedSettings.mjs', () => {
  assert.match(source, /checkSettings\(budget, baseline, LIVE\)/)
  assert.match(source, /mergeBaseline\(baseline, results, LIVE\)/)
  assert.doesNotMatch(source, /budget\.lab\.(runs|max|pages)/, 'the live check must not fall back to the lab settings')
})
