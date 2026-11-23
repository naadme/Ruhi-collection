// Each design's place by orders received, then views (public.product_rank,
// supabase/migrations/20261123120000_product_rank.sql) for the Recommended
// order of category pages (src/lib/recommendedOrder.js).
//
// Read once per visit and only on a category page. A visitor who lands on one
// already has the read under way: index.html starts it with the catalogue
// (src/boot/earlyStart.js). Arriving from another page of the shop, the read
// starts when the category page opens.
//
// The grid waits for it at most RANK_WAIT_MS. If it is slower, or fails, the
// page shows bestsellers, then new arrivals, then the rest newest first, and
// keeps that order while it is open: cards never jump once they are shown.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { earlyRows } from './earlyData.js'

export const RANK_WAIT_MS = 1500

/** design → position from `product_rank` rows; anything unreadable is left out. */
export function ranksFromRows(rows) {
  const ranks = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const position = Number(r?.position)
    if (typeof r?.design_id === 'string' && r.design_id && Number.isFinite(position)) ranks.set(r.design_id, position)
  }
  return ranks
}

let reading = null // the read of this visit, once started
let known = null // its answer, once it has come

async function readRanks() {
  try {
    const early = await earlyRows('ranks')
    if (early) return ranksFromRows(early)
    const { data, error } = await supabase.from('product_rank').select('design_id,position').retry(false)
    return error ? new Map() : ranksFromRows(data)
  } catch {
    return new Map()
  }
}

/** The positions, read once per visit (an empty Map when they cannot be read). */
export function productRanks() {
  if (!reading) reading = readRanks().then((ranks) => { known = ranks; return ranks })
  return reading
}

/**
 * `{ ranks, settled }` for a page that shows the Recommended order. `ranks`
 * stays null until the read answers; `settled` turns true when it has, or
 * after RANK_WAIT_MS, whichever is first. An answer after that is kept for
 * the next category page and not applied to this one.
 */
export function useProductRanks(enabled) {
  // Already read on an earlier page of this visit: no wait, not even a frame.
  const [state, setState] = useState(() => (known ? { ranks: known, settled: true } : { ranks: null, settled: false }))
  useEffect(() => {
    if (!enabled || state.settled) return undefined
    let alive = true
    let late = false
    const timer = setTimeout(() => {
      late = true
      if (alive) setState((s) => (s.settled ? s : { ranks: null, settled: true }))
    }, RANK_WAIT_MS)
    productRanks().then((ranks) => {
      clearTimeout(timer)
      if (alive && !late) setState({ ranks, settled: true })
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [enabled, state.settled])
  return state
}
