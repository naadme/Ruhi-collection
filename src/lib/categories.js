// Category reads and admin writes — the browser half of
// supabase/migrations/20261019130000_client_editable_categories.sql.
//
// The storefront only ever READS the list (public RLS policy). Creating,
// renaming and deleting a category is admin-only, exactly like banners and
// coupons: `authenticated` holds the table grant, but every write policy is
// gated on `is_admin()`, so a product manager can pick a category without
// being able to invent or remove one.
//
// The pure rules — key format, duplicate detection, merging — live in
// ./categoryRules.js so tests can use them without the Supabase client.

import { supabase } from './supabase.js'
import {
  CATEGORY_KEY_RE,
  SEED_CATEGORIES,
  categoriesFromDatabase,
  categoryKey,
  categoryLabelKey,
  cleanLabel,
  findDuplicate,
  mergeCategories,
  typeLabelOf,
  withTypeOption,
} from './categoryRules.js'

export {
  SEED_CATEGORIES,
  MAX_CATEGORY_LABEL,
  categoriesFromDatabase,
  categoryKey,
  categoryLabelKey,
  cleanLabel,
  findDuplicate,
  mergeCategories,
  typeLabelOf,
  withTypeOption,
} from './categoryRules.js'

/** Every category the store offers, in display order.
 *
 *  The homepage, shop filter, navigation and search all render this list, so
 *  it must never be empty and must never throw: a failed read falls back to
 *  the four seeded categories, which is exactly what the site showed before
 *  this feature existed. The admin panel asks for the strict form
 *  (`{ strict: true }`) so a real error is reported there instead of looking
 *  like a database that simply holds nothing. */
export async function fetchCategories({ strict = false } = {}) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('position', { ascending: true })
      .order('key', { ascending: true })
      .retry(false)
    if (error) throw new Error(error.message || 'Could not load the categories.')
    // The database answered, so the database is the truth: a category the
    // owner has deleted is not offered by the storefront any more, and one
    // they have added is offered at once. The seed is only for a database
    // that could not be reached — and for one that answers with nothing.
    const merged = categoriesFromDatabase(data || [])
    return merged.length ? merged : SEED_CATEGORIES
  } catch (e) {
    if (strict) throw e
    return SEED_CATEGORIES
  }
}

/** How many catalogue rows each category currently holds. This is the guard
 *  behind "never delete a category that is in use": the admin UI shows the
 *  count, and the database's foreign key refuses the delete whatever the UI
 *  believes. */
export async function categoryUsage() {
  // One column for every colour of every product. Supabase caps a page at
  // 1000 rows, so a larger catalogue would silently under-count — and an
  // under-count is exactly the thing that decides whether a Delete is
  // offered. Walk the pages instead of trusting the first answer.
  const counts = new Map()
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('type')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message || 'Could not check which categories are in use.')
    for (const r of data || []) {
      const key = String(r?.type ?? '')
      if (key) counts.set(key, (counts.get(key) || 0) + 1)
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return counts
}

/** Create a category from the name the client typed. The key is derived from
 *  the label, so the client never has to think about slugs — and two names
 *  that differ only by case, spacing or hyphenation ("Winter Wear" and
 *  "winter-wear") are refused before any write happens, in the UI and in the
 *  database's own unique index. */
export async function createCategory(label) {
  const clean = cleanLabel(label)
  const key = categoryKey(clean)
  if (!clean) throw new Error('Please enter a category name.')
  if (!key) throw new Error('Please type a name with at least one letter or number in it.')

  const existing = await fetchCategories({ strict: true })
  const clash = findDuplicate(existing, clean)
  if (clash) throw new Error(`“${clean}” is already a category.`)

  const position = existing.reduce((max, c) => Math.max(max, Number(c.position) || 0), -1) + 1
  // The category's own code — the two letters its products' Product IDs are
  // built from — is assigned by the database's own trigger, so nobody has to
  // set it by hand and a new category is numbered properly the moment it is
  // saved. The code comes back with the row.
  const { data, error } = await supabase
    .from('categories')
    .insert({ key, label: clean, position })
    .select('key, label, position, code')
    .single()
  if (error) {
    throw new Error(/duplicate/i.test(error.message || '')
      ? `“${clean}” is already a category.`
      : (error.message || 'Could not create that category.'))
  }
  return data
}

/** Rename a category's LABEL only. The key — and therefore every product's
 *  `type` — is never touched, so a rename can never detach a product: this is
 *  what makes renaming safe without any reassignment step. */
export async function renameCategory(key, label) {
  const clean = cleanLabel(label)
  if (!clean) throw new Error('Please enter a category name.')
  if (!categoryKey(clean)) throw new Error('Please type a name with at least one letter or number in it.')

  const existing = await fetchCategories({ strict: true })
  const clash = findDuplicate(existing, clean, key)
  // A category renamed to the label it already has is not a clash with a
  // different category; the duplicate itself was skipped above by key.
  if (clash) throw new Error(`“${clean}” is already used by “${clash.label}”.`)

  const { error } = await supabase.from('categories').update({ label: clean }).eq('key', key)
  if (error) throw new Error(error.message || 'Could not rename that category.')
  return clean
}

/** Delete a category — only when nothing uses it.
 *
 *  `usage` is the Map from categoryUsage() as the caller showed it. Passing
 *  `null` (or omitting it) means the count is UNKNOWN, and an unknown count
 *  is never treated as "0 in use": nothing is deleted on a guess. The database
 *  agrees independently — `products_type_fkey` is ON DELETE RESTRICT — so even
 *  a stale count cannot orphan a product. */
export async function deleteCategory(key, usage) {
  if (usage == null) {
    throw new Error('Could not check how many products use this category, so it was not deleted. Please try again.')
  }
  const inUse = Number(usage?.get?.(key) || 0)
  if (inUse > 0) {
    throw new Error(
      `${inUse} ${inUse === 1 ? 'product is' : 'products are'} still in this category. `
      + 'Move them to another category first, then delete it.',
    )
  }
  const { error } = await supabase.from('categories').delete().eq('key', key)
  if (error) {
    throw new Error(/foreign key|violates/i.test(error.message || '')
      ? 'That category still has products — move them first.'
      : (error.message || 'Could not delete that category.'))
  }
}
