import useExperiment from './useExperiment'
import { useExpressDelivery } from '../lib/shopSettings'
import { EXPRESS_TEST } from '../lib/expressTest'

/**
 * Whether to offer this visitor Express delivery by air: the dashboard's
 * switch is on, and the A/B test gives them the shop as it is ('a') rather
 * than the shop before Express ('b': no Express line on the product and cart
 * pages, one free-delivery line at checkout, the old policy and FAQ wording:
 * src/lib/expressTest.js).
 *
 * `ready` is the moment the shopper reaches a page that offers Express: a
 * product on screen (when view_item goes out), the cart page or checkout with
 * something in the cart. That is the same moment in both versions, and the
 * visitor counts in the test then, whether or not Express is paused (the
 * owner's call, 25 Nov 2026): the report splits the results into the hours
 * Express was on and the hours it was paused (express_switch_changes).
 */
export default function useExpressOffer(ready) {
  const on = useExpressDelivery()
  const version = useExperiment(EXPRESS_TEST, { active: Boolean(ready) })
  return on && version !== 'b'
}
