// One category list for the whole storefront and the admin panel.
//
// Every screen that names, filters or links a category reads this context
// instead of the bundled constant in src/data/products.js — that constant is
// now only the seed/fallback this context starts from, so a category the
// client adds appears everywhere at once (shop filter, header, footer,
// homepage tiles, search, breadcrumb) and cannot drift between them.
//
// The list is public data (RLS lets anyone read it), so it is loaded once per
// visit with the same never-blank, never-throw contract as the product
// catalogue: if Supabase is unreachable the four seeded categories render,
// exactly as the site behaved before categories were editable.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchCategories, SEED_CATEGORIES, typeLabelOf, withTypeOption } from '../lib/categories'

const Ctx = createContext(null)

/** Safe for any component, including ones rendered before the provider. */
const FALLBACK = {
  categories: SEED_CATEGORIES,
  typeLabel: (key) => typeLabelOf(SEED_CATEGORIES, key),
  reload: async () => SEED_CATEGORIES,
  loading: false,
}

export const useCategories = () => useContext(Ctx) || FALLBACK

export function CategoriesProvider({ children }) {
  const [categories, setCategories] = useState(SEED_CATEGORIES)
  const [loading, setLoading] = useState(true)

  // Re-read on demand (the admin panel calls this after every write) and once
  // on mount. Never throws: a failure keeps whatever is already on screen.
  const reload = useCallback(async () => {
    const next = await fetchCategories()
    setCategories(next)
    setLoading(false)
    return next
  }, [])

  useEffect(() => {
    let alive = true
    fetchCategories().then((rows) => {
      if (!alive) return
      setCategories(rows)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const typeLabel = useCallback((key) => typeLabelOf(categories, key), [categories])

  /** The list to hand a picker. A product can carry a category the merged
   *  list no longer offers — a type no seed row covers and no live row
   *  matched — and hiding it would let a client silently reassign that
   *  product to whichever category the browser showed by default. Callers
   *  pass the type in question; everyone else can ignore this. */
  const optionsFor = useCallback(
    (type) => withTypeOption(categories, type),
    [categories],
  )

  const value = useMemo(
    () => ({ categories, typeLabel, optionsFor, reload, loading }),
    [categories, typeLabel, optionsFor, reload, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
