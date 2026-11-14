// Which limits and which baseline a speed check uses, and how it saves a new
// baseline. Kept apart from speed-check.mjs so tests/speedCheck.test.js can check it.
//
// The lab check measures a local build, where the Meta pixel never loads (its GTM
// trigger needs the shop's own address). The live check measures the live site, which
// also runs the pixel. On 14 Nov 2026 GA4 and the Meta pixel caused about 95% of the
// live product page's blocking time, and the same code swung from about 140 to 280 ms
// between runs. So the live check has its own runs, its own limits and its own
// baseline, and is never compared with the lab numbers.

/** Settings for one check: `live` for npm run speed:live, otherwise the lab. */
export function checkSettings(budget, baseline, live) {
  const mode = live ? 'live' : 'lab'
  const own = budget[mode]
  if (!own?.runs || !own?.max) throw new Error(`speed-budget.json needs "${mode}.runs" and "${mode}.max"`)
  return {
    mode,
    runs: own.runs,
    max: own.max,
    prior: baseline?.[mode] ?? null,
    // Shared by both checks.
    pages: budget.lab.pages,
    goal: budget.lab.goal,
    lighthouse: budget.lab.lighthouse,
    toleranceMs: budget.lab.regressionToleranceMs,
  }
}

/**
 * The new speed-baseline.json. A live save replaces only the live numbers;
 * a lab save keeps the live numbers and any page it did not measure.
 */
export function mergeBaseline(baseline, results, live) {
  const old = baseline || {}
  if (live) return { ...old, live: { measuredAt: results.measuredAt, ...results.live } }
  const { live: _ignored, ...measured } = results
  return { ...old, ...measured, lab: { ...(old.lab || {}), ...(results.lab || {}) } }
}
