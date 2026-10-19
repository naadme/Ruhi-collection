import { createContext, useCallback, useContext, useEffect, useState } from 'react'
// Wishlist lives in one context so every product card reads the same state and
// stays in sync after navigation or remount. It is mirrored to localStorage.
const Ctx = createContext(null)
export const useWishlist = () => useContext(Ctx)
// Restores ONLY an array of ids. `JSON.parse` happily accepts `"{}"` or a bare
// number, and the old `|| []` forwarded those as-is — `ids.includes(...)` then
// threw and the whole app came down because a single malformed key. A
// non-array (or an array of junk) simply reads as an empty wishlist, which the
// shopper can recover from by saving a product again.
const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('wishlist'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState(read)
  useEffect(() => localStorage.setItem('wishlist', JSON.stringify(ids)), [ids])
  const has = useCallback((id) => ids.includes(id), [ids])
  const toggle = useCallback((id) => setIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])), [])
  return <Ctx.Provider value={{ ids, has, toggle }}>{children}</Ctx.Provider>
}
