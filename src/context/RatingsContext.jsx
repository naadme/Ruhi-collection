import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchRatingRows } from '../lib/reviewStore'
import { designRating, ratingTotals, shopRating } from '../lib/ratingSummary'

// The shop's published ratings, read once per visit and shared by every card,
// the product page, the phone buy bar, the cart and the checkout — one small
// request (product and stars only) instead of one per card.
//
// Until the answer arrives, and if it never does, every rating is null and
// nothing is drawn: a page never waits for its stars.

const EMPTY = new Map()
const Ctx = createContext({ ready: false, ratingFor: () => null, shop: null, totals: EMPTY })

export const useRatings = () => useContext(Ctx)

export function RatingsProvider({ children }) {
  const [totals, setTotals] = useState(EMPTY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    fetchRatingRows()
      .then((rows) => { if (alive) setTotals(ratingTotals(rows)) })
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  const ratingFor = useCallback((product) => designRating(totals, product), [totals])
  const value = useMemo(
    () => ({ ready, ratingFor, shop: shopRating(totals), totals }),
    [ready, ratingFor, totals],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
