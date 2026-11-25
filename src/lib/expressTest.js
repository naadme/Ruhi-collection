// The A/B test of Express delivery by air (src/lib/experimentList.js, 25 Nov
// 2026). Version a is the shop as it is; version b is the shop before Express
// (19 Nov 2026), for its shoppers in every word: no Express on the product and
// cart pages or at checkout (src/hooks/useExpressOffer.js), the Contact
// page's delivery answer (below) and the shipping and refund policies
// (src/lib/policyBeforeExpress.js, loaded with the policy page) as they read
// before Express.
import { variantOf } from './experiments.js'

export const EXPRESS_TEST = 'express_offer'

/** True when this visitor sees the shop before Express (version b). Fixed for the page load; counts no one. */
export const seesShopBeforeExpress = () => variantOf(EXPRESS_TEST) === 'b'

// The words before Express (finalization e54cdfa, live until 19 Nov 2026, 4:19 PM).
const DELIVERY_ANSWER_BEFORE = 'Most orders arrive in 7-10 working days across India.'

/** The FAQ as it read before Express: the delivery answer without Express. */
export function faqBeforeExpress(faq) {
  return faq.map(([q, a]) => [q, /express/i.test(a) ? DELIVERY_ANSWER_BEFORE : a])
}
