// Product lists for GA4's view_item_list and select_item (GA4 event schema,
// 8 Nov 2026): which list a card sits in, and when a card counts as seen.
//
// A list's id is fixed text; its name is what GA4's reports show. A card is
// seen once at least half of it has been on screen, and counts once per list
// shown — the cards seen within a moment of each other go out together as one
// view_item_list. Counting every card of a long grid on arrival would credit
// the bottom row with views nobody made, and GA4's list click-through rate is
// clicks divided by those views.
//
// Pure, so tests/itemLists.test.js can check it without a browser.

/** Lists that are always the same. */
export const LISTS = {
  homeBestSellers: { id: 'home_best_sellers', name: 'Home: Best Sellers' },
  related: { id: 'related_products', name: 'You may also like' },
  wishlist: { id: 'wishlist', name: 'Wishlist' },
  searchSuggestions: { id: 'search_suggestions', name: 'Search suggestions' },
}

/**
 * The shop page's list: a search covers the whole catalogue, so it is one
 * list whatever category was open (src/pages/Shop.jsx); otherwise the
 * category, or everything.
 */
export function shopList({ q = '', type = '', label = '' } = {}) {
  if (String(q).trim()) return { id: 'search_results', name: 'Search results' }
  const key = String(type).trim()
  if (key) return { id: `category_${key}`, name: `Category: ${String(label).trim() || key}` }
  return { id: 'all_products', name: 'All products' }
}

/** How long a list waits for more cards to come into view before sending the ones seen. */
export const BATCH_MS = 1000

/** How much of a card must be on screen for it to count as seen. */
export const SEEN_RATIO = 0.5

/**
 * Impressions for one list as it is shown. `saw(key, item)` marks a card as
 * seen (once per key); `flush()` sends what is waiting at once — before a
 * card is opened, so GA4 gets the view before the click, and when the list
 * goes away. `send` receives each batch of items; `schedule` and `cancel` are
 * setTimeout and clearTimeout outside tests.
 */
export function createImpressionBatch({ send, wait = BATCH_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const seen = new Set()
  let waiting = []
  let timer = null
  const flush = () => {
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
    if (!waiting.length) return
    const batch = waiting
    waiting = []
    send(batch)
  }
  return {
    saw(key, item) {
      if (!item || seen.has(key)) return
      seen.add(key)
      waiting.push(item)
      if (timer === null) timer = schedule(flush, wait)
    },
    flush,
  }
}
