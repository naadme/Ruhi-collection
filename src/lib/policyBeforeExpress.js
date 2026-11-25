// The shipping and refund policies as they read before Express (19 Nov 2026),
// for version b of the A/B test of Express (src/lib/expressTest.js). Kept out of
// the main file: only the policy page, which loads on demand, needs these words.

// The words before Express (finalization e54cdfa, live until 19 Nov 2026, 4:19 PM).
const FREE_SHIPPING_BEFORE = 'Shipping is free on every order, whatever the order value — there is no minimum spend and nothing extra to pay for delivery.'
// "Last updated" before Express; undefined shows the page-wide date.
const UPDATED_BEFORE = { 'shipping-policy': undefined, 'refund-policy': '5 November 2026' }

/** A policy as it read before Express: no Express lines, the old free-shipping line and date. */
export function policyBeforeExpress(slug, policy) {
  if (!policy || !(slug in UPDATED_BEFORE)) return policy
  return {
    ...policy,
    updated: UPDATED_BEFORE[slug],
    sections: policy.sections.map(([heading, paragraphs]) => [heading, paragraphs
      .filter((p) => typeof p !== 'string' || !/express/i.test(p))
      .map((p) => (typeof p === 'string' && p.startsWith('Standard delivery is free') ? FREE_SHIPPING_BEFORE : p))]),
  }
}
