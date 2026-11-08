import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useCategories } from '../context/CategoriesContext'
import { currentPageKey, newEventId, trackSafely } from '../lib/tracking'
import { listEvent, listItem } from '../lib/trackingItems'
import { SEEN_RATIO, createImpressionBatch } from '../lib/itemLists'

const ListCtx = createContext(null)

/** The list a ProductCard sits in ({ register, select }), or null outside one. */
export const useItemList = () => useContext(ListCtx)

/**
 * Wraps a grid of ProductCards so GA4 learns which cards were seen
 * (view_item_list) and which one was opened (select_item) — see
 * src/lib/itemLists.js. Renders nothing of its own.
 *
 * `list` is { id, name } from src/lib/itemLists.js. `products` are the
 * list's products in the order shown — all of them, also those on another
 * page of a paged row — so every card reports its place in the whole list.
 */
export default function ItemList({ list, products, children }) {
  const { typeLabel } = useCategories()
  const { id: listId, name: listName } = list

  // Each card's item, by product id, with its place in the list. A card the
  // catalogue cannot describe yet (no Product ID) has none and never counts.
  const items = useMemo(() => {
    const byId = new Map()
    ;(products || []).forEach((p, index) => {
      if (p?.id && !byId.has(p.id)) byId.set(p.id, listItem(p, { index, category: typeLabel(p.type) }))
    })
    return byId
  }, [products, typeLabel])
  const itemsNow = useRef(items)
  itemsNow.current = items

  // Another filter, sort, search or product is a new list: it counts afresh,
  // and what the old one saw is sent for the page that showed it.
  const version = `${listId}|${listName}|${[...items.keys()].join(',')}`
  const batch = useMemo(() => {
    const key = currentPageKey()
    return createImpressionBatch({
      send: (seen) => trackSafely(() => listEvent('view_item_list', seen, { listId, listName, eventId: newEventId() }), key),
    })
    // The version names everything the batch depends on.
  }, [version])
  useEffect(() => () => batch.flush(), [batch])

  const elements = useRef(new Map()) // product id → card element
  const idOf = useRef(new WeakMap()) // card element → product id
  const observer = useRef(null)
  const canObserve = typeof IntersectionObserver !== 'undefined'

  useEffect(() => {
    // Without IntersectionObserver nothing can tell what is on screen, so
    // every card shown counts as seen.
    if (!canObserve) {
      for (const id of elements.current.keys()) batch.saw(id, itemsNow.current.get(id))
      return undefined
    }
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < SEEN_RATIO) continue
        const id = idOf.current.get(entry.target)
        if (id) batch.saw(id, itemsNow.current.get(id))
        watch.unobserve(entry.target)
      }
    }, { threshold: SEEN_RATIO })
    observer.current = watch
    for (const el of elements.current.values()) watch.observe(el)
    return () => {
      watch.disconnect()
      observer.current = null
    }
  }, [batch, canObserve])

  /** A card's ref: its element when it mounts, null when it goes. */
  const register = useCallback((id, el) => {
    const before = elements.current.get(id)
    if (before && before !== el) {
      observer.current?.unobserve(before)
      elements.current.delete(id)
    }
    if (!el || !id) return
    elements.current.set(id, el)
    idOf.current.set(el, id)
    if (observer.current) observer.current.observe(el)
    else if (!canObserve) batch.saw(id, itemsNow.current.get(id))
  }, [batch, canObserve])

  /** The card was opened: what was seen goes first, then the card itself. */
  const select = useCallback((id) => {
    batch.flush()
    const item = itemsNow.current.get(id)
    trackSafely(() => listEvent('select_item', [item], { listId, listName, eventId: newEventId() }))
  }, [batch, listId, listName])

  const value = useMemo(() => ({ register, select }), [register, select])
  return <ListCtx.Provider value={value}>{children}</ListCtx.Provider>
}
