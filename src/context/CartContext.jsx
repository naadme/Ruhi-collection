import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useProducts } from './ProductsContext'
import { totalFor } from '../lib/pricing'
import { MAX_QTY } from '../lib/checkout'
const Ctx = createContext(null)
export const useCart = () => useContext(Ctx)
export function CartProvider({ children }) {
  const { getProduct } = useProducts()
  const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem('cart')) || [] } catch { return [] } })
  const [open, setOpen] = useState(false)
  useEffect(() => localStorage.setItem('cart', JSON.stringify(items)), [items])
  const add = (id, qty = 1, size = 'M') => {
    const wanted = Math.min(MAX_QTY, Math.max(1, qty))
    setItems((c) => {
      const k = c.find((i) => i.id === id && i.size === size)
      // Clamp the *sum*, not just the increment: a line already at 10 must not
      // be pushed to 11 by adding one more.
      return k
        ? c.map((i) => (i === k ? { ...i, qty: Math.min(MAX_QTY, i.qty + wanted) } : i))
        : [...c, { id, qty: wanted, size }]
    })
    setOpen(true)
  }
  const setQty = (id, size, qty) =>
    setItems((c) => c.map((i) => (i.id === id && i.size === size
      ? { ...i, qty: Math.min(MAX_QTY, Math.max(1, qty)) }
      : i)))
  const remove = (id, size) => setItems((c) => c.filter((i) => !(i.id === id && i.size === size)))
  const clear = () => setItems([])
  // Drop lines whose product no longer resolves (deleted or hidden by the
  // owner). Kept separate from `lines` so the UI can warn before pruning.
  const prune = useCallback(() => setItems((c) => c.filter((i) => !!getProduct(i.id))), [getProduct])
  const lines = items.map((i) => ({ ...i, product: getProduct(i.id) })).filter((l) => l.product)
  const unavailable = items.filter((i) => !getProduct(i.id)).length
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const subtotal = lines.reduce((s, l) => s + l.qty * l.product.price, 0)
  const total = totalFor(subtotal)
  return (
    <Ctx.Provider value={{ lines, unavailable, prune, clear, count, subtotal, total, add, setQty, remove, open, setOpen }}>
      {children}
    </Ctx.Provider>
  )
}
