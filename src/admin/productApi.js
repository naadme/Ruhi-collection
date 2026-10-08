// Every admin write to `products`, in one place, with the same contract:
//
//   write to Supabase → read the row back → prove the row really changed →
//   hand that row to React state.
//
// PostgREST answers a statement that touched no rows with `200` and *no
// error* — typically because row-level security filtered it out — so "the
// request came back" is never evidence that anything was saved. `.single()`
// turns the 0-row case into an error, and `assertSaved` proves the row that
// came back actually carries the values we sent. Only then does the caller
// touch local state; a failure leaves the previous product untouched and
// surfaces as a readable message in the editor.

import { supabase } from '../lib/supabase'

const NOT_SAVED =
  'Nothing was saved — your session may have expired. Sign in again and retry.'
const NOT_DELETED =
  'Nothing was deleted — your session may have expired. Sign in again and retry.'

/** PostgREST' "wanted one row, got none (or several)" answer. */
const noRow = (err) =>
  err?.code === 'PGRST116' || /JSON object requested/i.test(err?.message || '')

/** The message an admin can act on; raw errors are kept only when useful. */
const message = (err, fallback) => {
  if (!err) return fallback
  if (noRow(err)) return fallback
  const raw = (err.message || '').trim()
  if (!raw) return fallback
  if (/row-level security|permission denied|42501/i.test(raw)) {
    return 'This account is not allowed to change products. Sign in with the store owner account and retry.'
  }
  return raw
}

/**
 * Prove the row Supabase returned is the row we asked it to store.
 *
 * Compares every column of the payload against the returned row — a write that
 * was ignored, filtered by RLS, or silently coerced into something else throws
 * here instead of letting the dashboard announce a change the store never made.
 */
export function assertSaved(saved, payload) {
  if (!saved || !saved.id) throw new Error(NOT_SAVED)
  const same = (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    }
    if (typeof a === 'number' || typeof b === 'number') {
      return Number(a ?? 0) === Number(b ?? 0)
    }
    return (a ?? null) === (b ?? null)
  }
  const wrong = Object.keys(payload).filter((k) => !same(saved[k], payload[k]))
  if (wrong.length) {
    throw new Error(
      `Supabase stored different values for ${wrong.join(', ')} — this change was not saved. Nothing in the store was updated.`,
    )
  }
  return saved
}

/** Insert a new product; returns the row the database created. */
export async function createProduct(payload) {
  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw new Error(message(error, NOT_SAVED))
  return assertSaved(data, payload)
}

/** Update one product by id; returns the row the database stored. */
export async function updateProduct(payload) {
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', payload.id)
    .select('*')
    .single()
  if (error) throw new Error(message(error, NOT_SAVED))
  return assertSaved(data, payload)
}

/** Delete one product; returns the row the database removed. */
export async function deleteProduct(id) {
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(message(error, NOT_DELETED))
  if (!data?.id) throw new Error(NOT_DELETED)
  return data
}

/** Flip visibility; returns the row as the database stored it. */
export async function setProductActive(id, is_active) {
  return updateProduct({ id, is_active: !!is_active })
}
