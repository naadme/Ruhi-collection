// The admin-managed Best Sellers row (supabase/migrations/
// 20261019150000_admin_bestsellers.sql) — the Supabase-backed read and write.
//
// The pure rules live beside this file in `bestsellerRules.js` so they can be
// tested in plain Node; this module only speaks to the database.
//
// The homepage previously derived this row at render time by round-robining
// one style per category out of the live catalogue. That is still what happens
// when the owner has chosen nothing — the table starts empty, so the row looks
// exactly as it did before. Once a pick is saved, the homepage shows the
// owner's selection instead.
//
// Everything here reads and writes product IDS that already exist. Nothing is
// copied, nothing is invented, and because the foreign key is
// `on delete cascade` a deleted product takes its own promotion row with it —
// so the homepage can never point at a design the store no longer sells.

import { supabase } from './supabase'
import { MAX_BESTSELLERS, normalizePickRows, normalizePicks } from './bestsellerRules'

export { MAX_BESTSELLERS, locatePicks, resolveBestsellers } from './bestsellerRules'

/**
 * The owner's picks as `{ product_id, position, is_active }`, in display order.
 *
 * This deliberately returns IDS only. The homepage resolves them against the
 * products its `ProductsContext` has already mapped, so a promoted card is
 * built by exactly the same code path as every other card — same fields, same
 * price, same URL. Resolving by id also means a pick whose product has since
 * been deleted or hidden simply drops out instead of rendering a broken card.
 *
 * `is_active` says whether the owner has switched the design off. A design
 * that is switched off keeps its place in the order and is simply not in the
 * shop window.
 *
 * `strict: true` is for the admin panel: a permission or network failure is
 * thrown instead of looking like "the owner chose nothing", which the panel
 * could then overwrite. The homepage calls it without `strict` and simply
 * falls back to the derived row.
 */
export async function fetchBestsellers({ strict = false } = {}) {
  try {
    const { data, error } = await supabase
      .from('bestsellers')
      .select('product_id, position, is_active')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .retry(false)
    if (error) throw new Error(error.message || 'Could not load the best sellers.')

    return (data || [])
      .filter((row) => row && typeof row.product_id === 'string' && row.product_id)
      .map((row) => ({
        product_id: row.product_id,
        position: row.position,
        is_active: row.is_active !== false,
      }))
  } catch (e) {
    if (strict) throw e
    return []
  }
}

/**
 * Replace the whole list, in the given order.
 *
 * The panel keeps one ordered array in state and saves it whole: delete is
 * "remove from the array", reorder is "move within the array", add is
 * "append". Writing the full ordered set means the stored positions can never
 * disagree with what the admin was looking at.
 *
 * `picks` may be plain ids or `{ product_id, is_active }` rows — both are
 * written the same way, so a design that was switched off stays switched off
 * when the order around it changes.
 *
 * Order of operations is deliberate. The new selection is UPSERTed first —
 * one atomic statement — so a failure at that point leaves the previous
 * selection exactly as it was. Only then are rows that are no longer wanted
 * deleted, one targeted `eq` delete each. If that second phase fails, a stale
 * pick may linger visibly in this panel for a re-save to clear, which is far
 * better than the alternative: a delete-first approach that succeeded and then
 * failed to insert would quietly empty the owner's selection.
 *
 * Returns the saved ids in order.
 */
export async function saveBestsellers(picks) {
  const rows = normalizePickRows(picks)
  const ids = rows.map((r) => r.product_id)

  if (ids.length > MAX_BESTSELLERS) {
    throw new Error(`Choose at most ${MAX_BESTSELLERS} best sellers.`)
  }

  // 1. Write the new order. Upsert on the primary key, so a design already on
  //    the list has its position moved and a new one is appended.
  if (rows.length) {
    const payload = rows.map((row, position) => ({ product_id: row.product_id, position, is_active: row.is_active }))
    const { error: upsertError } = await supabase
      .from('bestsellers')
      .upsert(payload, { onConflict: 'product_id' })
    if (upsertError) throw new Error(upsertError.message || 'Could not save the best sellers.')
  }

  // 2. Drop what the new list no longer contains. Reading back first keeps
  //    this to `eq` filters — no string-built "not in" clause.
  const { data: current, error: readError } = await supabase
    .from('bestsellers')
    .select('product_id')
  if (readError) throw new Error(readError.message || 'Could not save the best sellers.')

  const keep = new Set(ids)
  const drop = (current || [])
    .map((r) => r?.product_id)
    .filter((id) => id && !keep.has(id))

  for (const id of drop) {
    const { error: deleteError } = await supabase
      .from('bestsellers')
      .delete()
      .eq('product_id', id)
    if (deleteError) throw new Error(deleteError.message || 'Could not save the best sellers.')
  }

  return ids
}
