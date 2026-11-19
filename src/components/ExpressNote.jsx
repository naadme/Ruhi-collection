import { EXPRESS_DAYS, EXPRESS_FEE_PER_ITEM, inr } from '../lib/pricing'
import { useExpressDelivery } from '../lib/shopSettings'

// Express delivery by air (19 Nov 2026), offered on the product page and the
// cart: optional, its price said up front, chosen at checkout. It shows only
// while the owner has Express switched on, and says nothing about where it
// reaches (every PIN code can have it). One copy of the words for both pages.
export default function ExpressNote({ className = '' }) {
  const on = useExpressDelivery()
  if (!on) return null
  return (
    <span className={className}>
      Need it sooner? <b className="font-semibold text-black/75">Express by air</b> in {EXPRESS_DAYS} days, {inr(EXPRESS_FEE_PER_ITEM)} per item, at checkout.
    </span>
  )
}
