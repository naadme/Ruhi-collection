import { createContext, useCallback, useContext, useEffect, useState } from 'react'
// Wishlist lives in one context so every product card reads the same state and
// stays in sync after navigation or remount. It is mirrored to localStorage.
const Ctx = createContext(null)
export const useWishlist = () => useContext(Ctx)
const read = () => { try { return JSON.parse(localStorage.getItem('wishlist')) || [] } catch { return [] } }
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState(read)
  useEffect(() => localStorage.setItem('wishlist', JSON.stringify(ids)), [ids])
  const has = useCallback((id) => ids.includes(id), [ids])
  const toggle = useCallback((id) => setIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])), [])
  return <Ctx.Provider value={{ ids, has, toggle }}>{children}</Ctx.Provider>
}
