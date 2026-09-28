import { useEffect, useState } from 'react'
export default function useWishlist() {
  const [ids, setIds] = useState(() => { try { return JSON.parse(localStorage.getItem('wishlist')) || [] } catch { return [] } })
  useEffect(() => localStorage.setItem('wishlist', JSON.stringify(ids)), [ids])
  return { has: (id) => ids.includes(id), toggle: (id) => setIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])) }
}
