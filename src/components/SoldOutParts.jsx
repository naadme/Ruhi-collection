import { lazy } from 'react'
import { Link } from 'react-router-dom'
import { noLongerAvailable, soldOutBlock, soldOutCartLines } from '../lib/soldOutParts'

// The on-demand sold-out parts as components (src/lib/soldOutParts.js). Each
// renders inside its caller's own <Suspense>, never the app-wide one. If a
// part's code cannot arrive, the block and the basket lines simply do not
// show (the page still says what is sold out), and a stopped style still gets
// a way back into the shop.
function StyleGone() {
  return (
    <section className="text-center py-32 px-4">
      <h1 className="text-[34px] md:text-[42px]">This style is no longer available</h1>
      <Link to="/shop" className="btn-outline mt-8">Shop everything</Link>
    </section>
  )
}

export const SoldOutBlock = lazy(soldOutBlock.lazy(() => null))
export const SoldOutCartLines = lazy(soldOutCartLines.lazy(() => null))
export const NoLongerAvailable = lazy(noLongerAvailable.lazy(StyleGone))
