// The GA4 event schema of 8 Nov 2026: the product-analytics events added on
// top of the brief's Section 3 — product lists, banners, wishlist saves,
// size picks, contact taps, coupons, checkout errors, sorting and the search
// result count — exactly as the site pushes them to GTM's data layer.
//
// The rules are the brief's (Annexure A): unknown values are left out, never
// sent as "", null or "undefined"; numbers stay numbers. And the schema's own:
// nothing a shopper typed or could be identified by (an email, a phone
// number, a PIN code, a message) ever reaches an event.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BRAND,
  CHECKOUT_ERRORS,
  SORT_ORDERS,
  cartEvent,
  checkoutErrorEvent,
  contactEvent,
  contactMethod,
  couponCodeParam,
  couponEvent,
  eventParams,
  heroPromotion,
  interactionEvent,
  listEvent,
  listItem,
  productIdFromPath,
  productParams,
  promotionEvent,
  searchEvent,
  sortEvent,
} from '../src/lib/trackingItems.js'
import { BATCH_MS, LISTS, SEEN_RATIO, createImpressionBatch, shopList } from '../src/lib/itemLists.js'

// A design in two colours, as the catalogue groups it for a product card.
const blue = { id: 'floral-anarkali-kurta-blue', sku: '0101BU', title: 'Floral Anarkali Kurta - Blue', type: 'kurtas', colour: 'Blue', color: 'Blue', price: 1299, compare: 1599, sizes: ['S', 'M', 'L'], design_id: '05-FAK-01' }
const red = { ...blue, id: 'floral-anarkali-kurta-red', sku: '0102RE', title: 'Floral Anarkali Kurta - Red', colour: 'Red', color: 'Red', price: 1199, compare: null, sizes: ['M', 'L'] }
const card = { ...blue, title: 'Floral Anarkali Kurta', colors: [blue, red] }

const blueS = {
  item_id: '0101BU_S',
  item_group_id: '05-FAK-01',
  item_name: 'Floral Anarkali Kurta',
  item_brand: BRAND,
  item_category: 'Kurtas',
  item_variant: 'Blue / S',
  price: 1299,
  discount: 300,
  quantity: 1,
}

test('eventParams keeps tidy text, numbers and true/false — and nothing else', () => {
  assert.deepEqual(
    eventParams({ size: '  M ', results: 0, size_change: true, gone: undefined, empty: '  ', none: null, obj: { a: 1 }, nan: NaN }),
    { size: 'M', results: 0, size_change: true },
  )
  assert.equal(eventParams({ a: undefined, b: '' }), undefined)
  assert.equal(eventParams(undefined), undefined)
  // GA4 keeps 100 characters of a value; the rest is cut before it is sent.
  assert.equal(eventParams({ long: 'x'.repeat(150) }).long.length, 100)
})

test('the brief’s events are unchanged unless a parameter is given', () => {
  const plain = cartEvent('add_to_cart', [blueS], { eventId: 'e1' })
  assert.equal('event_params' in plain, false)
  assert.deepEqual(cartEvent('add_to_cart', [blueS], { eventId: 'e1', params: { method: 'buy_now' } }), {
    event: 'add_to_cart',
    event_id: 'e1',
    event_params: { method: 'buy_now' },
    ecommerce: { currency: 'INR', value: 1299, items: [blueS] },
  })
  // A product view that only changed size is marked, so GA4 can count one view per page.
  assert.deepEqual(cartEvent('view_item', [blueS], { eventId: 'e2', params: { size_change: true } }).event_params, { size_change: true })
  assert.equal('event_params' in cartEvent('view_item', [blueS], { eventId: 'e3', params: { size_change: undefined } }), false)
})

test('add_to_wishlist is GA4’s own e-commerce shape: currency, value and the item', () => {
  assert.deepEqual(cartEvent('add_to_wishlist', [blueS], { eventId: 'w1' }), {
    event: 'add_to_wishlist',
    event_id: 'w1',
    ecommerce: { currency: 'INR', value: 1299, items: [blueS] },
  })
})

test('search says how many styles a term found, 0 included, once that is known', () => {
  assert.deepEqual(searchEvent(' red  dress ', { eventId: 's1', results: 0 }), {
    event: 'search',
    event_id: 's1',
    search_term: 'red dress',
    event_params: { search_results: 0 },
  })
  assert.deepEqual(searchEvent('red', { eventId: 's2', results: 7 }).event_params, { search_results: 7 })
  // The catalogue never answered: the brief's search, without a count.
  assert.deepEqual(searchEvent('red', { eventId: 's3' }), { event: 'search', event_id: 's3', search_term: 'red' })
  assert.equal('event_params' in searchEvent('red', { eventId: 's4', results: -1 }), false)
  assert.equal(searchEvent('   ', { eventId: 's5', results: 3 }), null)
})

test('a list card is the colour it shows, in its first size, with its place in the list', () => {
  assert.deepEqual(listItem(card, { index: 0, category: 'Kurtas' }), { ...blueS, index: 0 })
  // A card that leads with another colour (a colour search) is that colour.
  const redCard = { ...card, ...red, title: card.title, colors: card.colors }
  const item = listItem(redCard, { index: 3, category: 'Kurtas' })
  assert.equal(item.item_id, '0102RE_M')
  assert.equal(item.item_group_id, '05-FAK-01')
  assert.equal(item.index, 3)
  // No Product ID yet (the bundled catalogue): no item, so it is never counted.
  assert.equal(listItem({ ...card, sku: '', colors: [] }, { index: 0 }), null)
  assert.equal('index' in listItem(card, { category: 'Kurtas' }), false)
})

test('view_item_list and select_item carry the list’s id and name', () => {
  const seen = [listItem(card, { index: 0, category: 'Kurtas' })]
  assert.deepEqual(listEvent('view_item_list', seen, { listId: 'category_kurtas', listName: 'Category: Kurtas', eventId: 'l1' }), {
    event: 'view_item_list',
    event_id: 'l1',
    ecommerce: { item_list_id: 'category_kurtas', item_list_name: 'Category: Kurtas', items: seen },
  })
  // A suggestion opened from the search box also says what was typed.
  assert.deepEqual(
    listEvent('select_item', seen, { listId: LISTS.searchSuggestions.id, listName: LISTS.searchSuggestions.name, eventId: 'l2', params: { search_term: 'kurta' } }).event_params,
    { search_term: 'kurta' },
  )
  assert.equal(listEvent('select_item', [null], { listId: 'x', listName: 'X', eventId: 'l3' }), null)
})

test('the shop page names its list after the search, the category or everything', () => {
  assert.deepEqual(shopList({ q: 'red', type: 'kurtas', label: 'Kurtas' }), { id: 'search_results', name: 'Search results' })
  assert.deepEqual(shopList({ type: 'kurtas', label: 'Kurtas' }), { id: 'category_kurtas', name: 'Category: Kurtas' })
  assert.deepEqual(shopList({ type: 'kurtas' }), { id: 'category_kurtas', name: 'Category: kurtas' })
  assert.deepEqual(shopList({ q: '   ' }), { id: 'all_products', name: 'All products' })
  for (const list of Object.values(LISTS)) assert.match(list.id, /^[a-z_]+$/)
})

test('impressions: each card once, sent in batches, everything waiting sent before a click', () => {
  const sent = []
  const timers = []
  const batch = createImpressionBatch({
    send: (items) => sent.push(items.map((i) => i.id)),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    cancel: (id) => { timers[id - 1].cancelled = true },
  })
  batch.saw('a', { id: 'a' })
  batch.saw('b', { id: 'b' })
  batch.saw('a', { id: 'a' }) // the same card again
  batch.saw('c', null) // a card that cannot be described
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, BATCH_MS)
  timers[0].fn()
  assert.deepEqual(sent, [['a', 'b']])

  batch.saw('c', { id: 'c' })
  batch.flush() // a card is opened: no waiting
  assert.deepEqual(sent, [['a', 'b'], ['c']])
  assert.equal(timers[1].cancelled, true)
  batch.flush()
  assert.equal(sent.length, 2)
  batch.saw('b', { id: 'b' }) // already counted for this list
  assert.equal(timers.length, 2)
  assert.equal(SEEN_RATIO, 0.5)
})

test('a hero photo is a promotion: banner by id and destination, category photo by name', () => {
  const banner = { key: '7f0c…uuid', image: 'https://cdn.example.com/banners/diwali%20sale.jpg?w=1600', to: '/shop?type=dresses', label: 'Shop now' }
  assert.deepEqual(heroPromotion(banner, 0, { banner: true }), {
    id: '7f0c…uuid', name: 'Banner: /shop?type=dresses', creative: 'diwali sale.jpg', slot: 'home_hero_1', to: '/shop?type=dresses',
  })
  const tile = { key: 'dresses', image: '/images/products/stripes-dress-blue.jpg', to: '/product/stripes-dress-blue', label: 'Dresses' }
  assert.deepEqual(heroPromotion(tile, 2), { id: 'dresses', name: 'Dresses', creative: 'stripes-dress-blue.jpg', slot: 'home_hero_3', to: '/product/stripes-dress-blue' })
  assert.equal(heroPromotion(null, 0), null)

  // GA4 requires items on view_promotion: the product the photo opens…
  assert.equal(productIdFromPath(tile.to), 'stripes-dress-blue')
  assert.equal(productIdFromPath('/product/a%20b?size=M'), 'a b')
  assert.equal(productIdFromPath(banner.to), undefined)
  assert.deepEqual(promotionEvent('view_promotion', heroPromotion(tile, 2), { eventId: 'p1', item: blueS }), {
    event: 'view_promotion',
    event_id: 'p1',
    ecommerce: {
      promotion_id: 'dresses', promotion_name: 'Dresses', creative_name: 'stripes-dress-blue.jpg', creative_slot: 'home_hero_3',
      items: [blueS],
    },
  })
  // …or, for a banner that opens a category, one entry naming where it leads.
  assert.deepEqual(promotionEvent('select_promotion', heroPromotion(banner, 0, { banner: true }), { eventId: 'p2' }).ecommerce.items, [
    { item_id: '/shop?type=dresses', item_name: 'Banner: /shop?type=dresses' },
  ])
  assert.equal(promotionEvent('view_promotion', { creative: 'x.jpg' }, { eventId: 'p3' }), null)
})

test('interactions put their parameters in event_params, with an event_id like every event', () => {
  assert.deepEqual(interactionEvent('select_size', { size: 'M', color: 'Blue', ...productParams(blueS) }, { eventId: 'i1' }), {
    event: 'select_size',
    event_id: 'i1',
    event_params: { size: 'M', color: 'Blue', design_id: '05-FAK-01', product_name: 'Floral Anarkali Kurta', product_category: 'Kurtas' },
  })
  assert.deepEqual(interactionEvent('view_size_chart', {}, { eventId: 'i2' }), { event: 'view_size_chart', event_id: 'i2' })
  assert.equal(interactionEvent('', { a: 1 }), null)
  assert.deepEqual(productParams(null), {})
})

test('contact: which channel and which link — never the number or the address', () => {
  assert.equal(contactMethod('https://wa.me/919046651272?text=Hi'), 'whatsapp')
  assert.equal(contactMethod('https://api.whatsapp.com/send?phone=919046651272'), 'whatsapp')
  assert.equal(contactMethod('https://www.instagram.com/ruhi_fashions_/'), 'instagram')
  assert.equal(contactMethod('tel:+919046651272'), 'phone')
  assert.equal(contactMethod('mailto:ruhicollections2026@gmail.com?subject=Order'), 'email')
  assert.equal(contactMethod('/contact'), undefined)
  assert.equal(contactMethod('https://example.com/wa.me'), undefined)
  assert.equal(contactMethod(undefined), undefined)

  const tap = contactEvent('https://wa.me/919046651272?text=Hi', { location: 'product_whatsapp_button', product: blueS, eventId: 'c1' })
  assert.deepEqual(tap, {
    event: 'contact',
    event_id: 'c1',
    event_params: { method: 'whatsapp', link_location: 'product_whatsapp_button', design_id: '05-FAK-01', product_name: 'Floral Anarkali Kurta', product_category: 'Kurtas' },
  })
  assert.doesNotMatch(JSON.stringify(contactEvent('tel:+919046651272', { location: 'footer', eventId: 'c2' })), /9046651272/)
  assert.doesNotMatch(JSON.stringify(contactEvent('mailto:ruhicollections2026@gmail.com', { location: 'footer', eventId: 'c3' })), /@/)
  assert.equal(contactEvent('/about', { location: 'footer' }), null)
})

test('sort_products names the order chosen; an unknown option sends nothing', () => {
  assert.deepEqual(sortEvent('low', { eventId: 'o1' }), { event: 'sort_products', event_id: 'o1', event_params: { sort_order: 'price_low_to_high' } })
  assert.equal(sortEvent('', { eventId: 'o2' }).event_params.sort_order, 'featured')
  assert.equal(sortEvent('cheapest'), null)
  assert.deepEqual(Object.keys(SORT_ORDERS), ['', 'low', 'high', 'rating', 'name'])
})

test('apply_coupon: a code that looks like a code, and what came of it', () => {
  assert.equal(couponCodeParam(' diwali10 '), 'DIWALI10')
  assert.equal(couponCodeParam('FIRST-ORDER_5'), 'FIRST-ORDER_5')
  // Typed into the wrong box: never sent.
  assert.equal(couponCodeParam('priya@example.com'), undefined)
  assert.equal(couponCodeParam('9876543210'), undefined)
  assert.equal(couponCodeParam('411001'), undefined)
  assert.equal(couponCodeParam('two words'), undefined)
  assert.equal(couponCodeParam(''), undefined)

  assert.deepEqual(couponEvent('diwali10', 'applied', { eventId: 'k1' }), {
    event: 'apply_coupon', event_id: 'k1', event_params: { coupon_code: 'DIWALI10', coupon_result: 'applied' },
  })
  assert.deepEqual(couponEvent('98765 43210', 'rejected', { eventId: 'k2' }).event_params, { coupon_result: 'rejected' })
})

test('checkout_error: the kind, the names of fields to fix and the gateway’s reason — never what was typed', () => {
  assert.deepEqual(checkoutErrorEvent('invalid_details', { fields: ['phone', 'pincode'], eventId: 'x1' }), {
    event: 'checkout_error', event_id: 'x1', event_params: { error_type: 'invalid_details', error_fields: 'phone,pincode' },
  })
  assert.deepEqual(checkoutErrorEvent('payment_attempt_failed', { reason: 'instrument_declined', eventId: 'x2' }).event_params, {
    error_type: 'payment_attempt_failed', error_reason: 'instrument_declined',
  })
  assert.deepEqual(checkoutErrorEvent('payment_cancelled', { reason: '', eventId: 'x3' }).event_params, { error_type: 'payment_cancelled' })
  assert.equal(checkoutErrorEvent('something_else', { eventId: 'x4' }), null)
  for (const type of CHECKOUT_ERRORS) assert.match(type, /^[a-z_]{1,40}$/)
})

test('every event and parameter name fits GA4’s naming rules', () => {
  const names = [
    'view_item_list', 'select_item', 'view_promotion', 'select_promotion', 'add_to_wishlist', 'select_size', 'view_size_chart',
    'contact', 'generate_lead', 'apply_coupon', 'checkout_error', 'sort_products',
    'method', 'size_change', 'search_results', 'search_term', 'size', 'color', 'design_id', 'product_name', 'product_category',
    'link_location', 'lead_source', 'coupon_code', 'coupon_result', 'error_type', 'error_fields', 'error_reason', 'sort_order',
  ]
  for (const name of names) {
    // Letters, digits and underscores, starting with a letter, at most 40 characters,
    // and none of GA4's reserved prefixes.
    assert.match(name, /^[a-z][a-z0-9_]{0,39}$/, name)
    assert.doesNotMatch(name, /^(_|firebase_|ga_|google_|gtag\.)/, name)
  }
})

test('every event starts from a clean slate, and a broken event never throws into the shop', async () => {
  const { PARAMS_KEY, pageShown, trackEvent, trackSafely } = await import('../src/lib/tracking.js')
  assert.equal(PARAMS_KEY, 'event_params')
  globalThis.window = { location: { pathname: '/shop', search: '?type=kurtas&sort=low' }, dataLayer: [] }
  try {
    pageShown('/shop?type=kurtas')
    trackEvent({ event: 'sort_products', event_id: 'a', event_params: { sort_order: 'price_low_to_high' } })
    // GTM keeps every value until it is overwritten: clearing both objects
    // first means no tag can read a parameter of an earlier event.
    assert.deepEqual(window.dataLayer, [
      { ecommerce: null, event_params: null },
      { event: 'sort_products', event_id: 'a', event_params: { sort_order: 'price_low_to_high' } },
    ])
    trackSafely(() => { throw new Error('a bug in measuring') })
    trackSafely(() => null)
    trackEvent(null)
    assert.equal(window.dataLayer.length, 2)
    // An event seen on a page that is no longer on screen waits for that page, as the brief's events do.
    trackEvent({ event: 'view_item_list', event_id: 'b' }, '/product/x')
    assert.equal(window.dataLayer.length, 2)
  } finally {
    delete globalThis.window
  }
})
