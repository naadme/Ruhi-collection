// The A/B tests an order was placed in, as the order record keeps them.
//
// Checkout sends { test: version } for the running tests the shopper was
// counted in (src/lib/experiments.js), and create-razorpay-order saves it in
// orders.experiments so that paid orders per version come from the database.
// Nothing about it is trusted beyond its shape: a test id is lower case
// letters, digits and _ (at most 20 characters), a version is a, b or c, and
// an order is in at most four tests, the most that can run at once.
//
// Plain JavaScript so the Edge Function and the test suite share it.

export const MAX_TESTS = 4
const ID = /^[a-z][a-z0-9_]{0,19}$/
const VERSIONS = new Set(['a', 'b', 'c'])

/** The orders.experiments value for what the browser sent, or null when there is nothing sound to keep. */
export function experimentsColumn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (!entries.length || entries.length > MAX_TESTS) return null
  if (!entries.every(([id, version]) => ID.test(id) && typeof version === 'string' && VERSIONS.has(version))) return null
  return Object.fromEntries(entries.sort(([x], [y]) => (x < y ? -1 : 1)))
}
