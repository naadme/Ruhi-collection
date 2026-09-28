import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { products as seedProducts } from '../data/products'

const Ctx = createContext(null)
export const useProducts = () => useContext(Ctx)

// Database row -> the exact shape the storefront already consumes
// (see src/data/products.js; `description` maps to the legacy `desc`).
const toProduct = (r) => ({
  id: r.id,
  title: r.title,
  gender: r.gender,
  type: r.type,
  price: Number(r.price) || 0,
  compare: r.compare === null || r.compare === undefined ? null : Number(r.compare),
  rating: Number(r.rating) || 0,
  reviews: Number(r.reviews) || 0,
  image: r.image,
  hover: r.hover,
  badge: r.badge,
  sizes: Array.isArray(r.sizes) && r.sizes.length ? r.sizes : ['S', 'M', 'L', 'XL'],
  desc: r.description || '',
  is_active: r.is_active !== false,
})

const seed = seedProducts.map((p) => ({ ...p, is_active: true }))

export function ProductsProvider({ children }) {
  const [all, setAll] = useState(seed)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState('seed')

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: true })
      if (error) {
        // Keep the bundled catalogue so the storefront never breaks.
        setError(error.message); setSource('seed')
      } else {
        setAll((data || []).map(toProduct)); setError(null); setSource('database')
      }
    } catch (e) {
      setError(e?.message || 'Unavailable'); setSource('seed')
    } finally { setLoading(false) }
    return true
  }, [])

  // First fetch must happen *after* the Supabase session is restored — otherwise
  // an admin loading /admin straight would receive the anonymous, hidden-filtered
  // view and never see unpublished rows. Re-fetch on sign-in/out too, so the
  // visible set always matches the caller's permissions.
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(() => { if (alive) reload() }).catch(() => { if (alive) reload() })
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') reload()
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [reload])

  // Live updates: edit something in the dashboard and any open storefront
  // tab refreshes itself. Silently a no-op if realtime is unavailable.
  useEffect(() => {
    let channel
    try {
      channel = supabase
        .channel('products-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { reload() })
        .subscribe()
    } catch { /* realtime optional */ }
    return () => { if (channel) { try { supabase.removeChannel(channel) } catch { /* noop */ } } }
  }, [reload])

  const products = useMemo(() => all.filter((p) => p.is_active), [all])
  // The storefront only ever resolves *visible* products, regardless of who is
  // signed in — hidden items live exclusively in the dashboard.
  const getProduct = useCallback((id) => all.find((p) => p.id === id && p.is_active) || null, [all])

  return (
    <Ctx.Provider value={{ products, all, getProduct, reload, loading, error, source }}>
      {children}
    </Ctx.Provider>
  )
}
