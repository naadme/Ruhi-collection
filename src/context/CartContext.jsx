import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  // `color` is the colour chosen on the product page. Lines stay keyed by
  // id + size: a grouped design's colour rows keep their own ids, so two
  // colours are already two distinct lines.
  const add = useCallback((id, qty = 1, size = 'M', color) => {
    const wanted = Math.min(MAX_QTY, Math.max(1, qty))
    setItems((c) => {
      const k = c.find((i) => i.id === id && i.size === size)
      // Clamp the *sum*, not just the increment: a line already at 10 must not
      // be pushed to 11 by adding one more.
      return k
        ? c.map((i) => (i === k ? { ...i, qty: Math.min(MAX_QTY, i.qty + wanted) } : i))
        : [...c, { id, qty: wanted, size, ...(color ? { color } : {}) }]
    })
    setOpen(true)
  }, [])
  const setQty = useCallback((id, size, qty) =>
    setItems((c) => c.map((i) => (i.id === id && i.size === size
      ? { ...i, qty: Math.min(MAX_QTY, Math.max(1, qty)) }
      : i))), [])
  const remove = useCallback((id, size) => setItems((c) => c.filter((i) => !(i.id === id && i.size === size))), [])
  const clear = useCallback(() => setItems([]), [])
  // Drop lines whose product no longer resolves (deleted or hidden by the
  // owner). Kept separate from `lines` so the UI can warn before pruning.
  const prune = useCallback(() => setItems((c) => c.filter((i) => !!getProduct(i.id))), [getProduct])
  // Derived in one pass and memoised: the basket view, the header badge and the
  // checkout summary all read these, and they must not be rebuilt on renders
  // that only touch `open`.
  const { lines, unavailable, count, subtotal } = useMemo(() => {
    const built = []
    let missing = 0
    let qty = 0
    let sub = 0
    for (const i of items) {
      const product = getProduct(i.id)
      if (!product) { missing += 1; continue }
      // The line can name a colour row of a grouped design. Resolve it so the
      // basket, drawer and checkout all show that colour's name and photo —
      // `color` covers lines saved before this existed, the lookup covers any
      // line saved without it.
      const variant = (product.colors || []).find((c) => c.id === i.id)
      const color = i.color || (variant ? variant.color : undefined)
      built.push({ ...i, color, image: (variant && variant.image) || product.image, product })
      qty += i.qty
      sub += i.qty * product.price
    }
    return { lines: built, unavailable: missing, count: qty, subtotal: sub }
  }, [items, getProduct])
  const total = useMemo(() => totalFor(subtotal), [subtotal])
  const value = useMemo(
    () => ({ lines, unavailable, prune, clear, count, subtotal, total, add, setQty, remove, open, setOpen }),
    [lines, unavailable, prune, clear, count, subtotal, total, add, setQty, remove, open],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}
