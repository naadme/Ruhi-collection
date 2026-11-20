// Every admin read and write for sold out (20 Nov 2026), in one place.
// The database side is supabase/migrations/20261120210000_sold_out.sql.

import { supabase } from '../lib/supabase'

const NOT_ALLOWED = 'This account is not allowed to change stock. Sign in with the store owner account and retry.'
const NOT_SAVED = 'The change was not saved. Refresh the page and try again.'

/**
 * Mark `sizes` of one colour row sold out (`soldOut` true) or back in stock,
 * in one atomic database call, and return the row as the database now holds
 * it. Like every product write (src/admin/productApi.js), the answer is
 * checked: a call that changed nothing is an error, never a success.
 */
export async function setSoldOut(id, sizes, soldOut) {
  const { data, error } = await supabase.rpc('set_sold_out', { p_id: id, p_sizes: sizes, p_sold_out: !!soldOut })
  if (error) {
    const raw = `${error.code || ''} ${error.message || ''}`
    throw new Error(/42501|permission|not allowed/i.test(raw) ? NOT_ALLOWED : (error.message || NOT_SAVED))
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.id) throw new Error(NOT_SAVED)
  const marked = Array.isArray(row.sold_out_sizes) ? row.sold_out_sizes : []
  const offered = Array.isArray(row.sizes) ? row.sizes : []
  if (sizes.some((s) => offered.includes(s) && marked.includes(s) !== !!soldOut)) throw new Error(NOT_SAVED)
  return row
}

/** The open sold-out alerts: live colours sold out in every size, oldest first. */
export async function fetchOpenAlerts() {
  const { data, error } = await supabase
    .from('sold_out_alerts')
    .select('product_id, sold_out_at')
    .is('closed_at', null)
    .order('sold_out_at', { ascending: true })
  if (error) throw new Error(error.message || 'Could not read the sold-out alerts.')
  return data || []
}

/** Close one alert ("Done"). It comes back only if the colour sells out again. */
export async function closeAlert(productId) {
  const { data, error } = await supabase
    .from('sold_out_alerts')
    .update({ closed_at: new Date().toISOString() })
    .eq('product_id', productId)
    .select('product_id')
  if (error || !data?.length) throw new Error(error?.message || 'The alert was not closed. Try again.')
}

/**
 * Paid pieces per colour row over the last `days` days, test orders left out:
 * what makes one colour "the best in stock". Only the owner can read orders;
 * anyone else gets an empty answer and the rule falls back to sizes in stock.
 */
export async function fetchPaidPieces(ids, days = 30) {
  if (!ids.length) return new Map()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('order_items')
    .select('product_id, qty, orders!inner(payment_status, is_test, created_at)')
    .in('product_id', ids)
    .eq('orders.payment_status', 'paid')
    .eq('orders.is_test', false)
    .gte('orders.created_at', since)
  const pieces = new Map()
  if (error) return pieces
  for (const line of data || []) pieces.set(line.product_id, (pieces.get(line.product_id) || 0) + (Number(line.qty) || 0))
  return pieces
}
