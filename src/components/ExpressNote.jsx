import { EXPRESS_DAYS, EXPRESS_FEE_PER_ITEM, inr } from '../lib/pricing'

// Express delivery by air (19 Nov 2026), offered on the product page and the
// cart: optional, its price said up front, chosen at checkout. It shows only
// when the page offers Express to this visitor (`on`, from useExpressOffer:
// the owner has it switched on and the A/B test gives them the shop with
// Express), and says nothing about where it reaches (every PIN code can have
// it). One copy of the words for both pages.
export default function ExpressNote({ on, className = '' }) {
  if (!on) return null
  return (
    <span className={className}>
      Need it sooner? <b className="font-semibold text-black/75">Express by air</b> in {EXPRESS_DAYS} days, {inr(EXPRESS_FEE_PER_ITEM)} per item, at checkout.
    </span>
  )
}
