// What GTM's e-commerce events say about products, carts and orders (tracking
// brief, Section 3 and Annexure A3–A10), built in one place so the IDs in every
// event — and in the product feed — can never drift apart.
//
// IDs (brief Sections 3 and 8). The shop's own Product ID, six characters such
// as 0314BL, belongs to ONE COLOUR of a design (src/lib/productIdentity.js),
// and sizes have no ID of their own. So:
//
//   item_id         the Product ID and the size          0314BL_M
//   item_group_id   the design, shared by every colour   03-FMD-01
//
// The group ID is the design ID the database assigns once and never changes
// (`products.design_id`, 20261102130000_design_ids.sql). A row without one —
// a database the migration has not reached yet — falls back to an ID written
// from the site's own rule for which rows are one design: the same category
// and design name (src/lib/productGrouping.js).
//
// Annexure A's rules hold for everything built here: numbers are numbers,
// unknown values are left out, and items never carry customer details.
//
// Pure, so tests/trackingItems.test.js can check it without a browser.

import { compact, customerFields } from './tracking.js'
import { orderLineColour, orderLineName } from './orderLine.js'
import { partsOf, variantFor } from './productGrouping.js'

export const CURRENCY = 'INR'

/**
 * item_brand, and the feed's `brand`, the same in both: the brand name the
 * owner chose (brief Section 3), not the storefront's "Ruhi Womens Clothing".
 */
export const BRAND = 'Ruhi Collections'

/** shipping_tier: the shop has one delivery option, free, in 7–10 working days. */
export const SHIPPING_TIER = 'standard'

/** payment_type values the brief allows (Section 3). */
export const PAYMENT_TYPES = new Set(['upi', 'card', 'netbanking', 'wallet', 'cod'])

const text = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')
const round = (n) => Math.round(n * 100) / 100

/** A price in rupees, or undefined when there is none. A ₹0 price is a price not set yet. */
export function price(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? round(n) : undefined
}

/** An amount in rupees where ₹0 is real (free shipping), or undefined. */
export function amount(value) {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? round(n) : undefined
}

/** "0314BL" and "M" → "0314BL_M"; undefined when either is missing — no ID is made up. */
export function itemId(productId, size) {
  const id = text(productId)
  const s = text(size)
  return id && s ? `${id}_${s}` : undefined
}

// Google's limit for item_group_id; Meta allows 100.
const MAX_GROUP_ID = 50

const slug = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

/** A short fingerprint of a string (32-bit FNV-1a), the same on every run. */
const fingerprint = (value) => {
  let hash = 0x811c9dc5
  for (const ch of value) hash = Math.imul(hash ^ ch.codePointAt(0), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

/**
 * item_group_id for a catalogue row: one ID for every colour and size of its
 * design, so Meta and Google show the colours as options of one product.
 *
 * The row's stored design ID when it has one ("03-FMD-01"). Otherwise the
 * design's category and name, the pair that makes rows one design on the
 * site, as a lower-case slug cut to fit, then a fingerprint of that exact
 * pair: "dress_floral-maxi-dress-1b2c3d4e". The site keeps "Embroidery Coord
 * set" and "Embroidery coord set" apart, and Google ignores case in IDs, so
 * the slug alone could merge two designs. A row that names no colour is a
 * design of its own and keeps its Product ID.
 */
export function designGroupId(row) {
  const stored = text(row?.design_id)
  if (stored) return stored
  const parts = partsOf(row)
  const name = parts ? slug(parts.name) : ''
  if (!name) return text(row?.sku) || undefined
  const readable = [slug(row.type), name].filter(Boolean).join('_').slice(0, MAX_GROUP_ID - 9).replace(/[-_]+$/, '')
  return `${readable}-${fingerprint(`${row.type}\u0000${parts.name}`)}`
}

/**
 * One entry of `items`, in Annexure A's field order, or null when the product
 * has no Product ID yet (the bundled catalogue the page paints first has none).
 *
 * `price` is what one unit is sold for; `compare` is the struck-through price
 * before the shop's markdown, and the difference is the per-unit `discount`.
 * `groupId` is the design's (designGroupId); a product no longer in the
 * catalogue falls back to its Product ID, so the field is always there.
 */
export function trackedItem({ productId, groupId, size, name, colour, category, price: unit, compare, quantity = 1 } = {}) {
  const id = itemId(productId, size)
  if (!id) return null
  const charged = price(unit)
  const before = price(compare)
  return compact({
    item_id: id,
    item_group_id: text(groupId) || text(productId),
    item_name: text(name),
    item_brand: BRAND,
    item_category: text(category),
    item_variant: [text(colour), text(size)].filter(Boolean).join(' / '),
    price: charged,
    discount: charged !== undefined && before > charged ? round(before - charged) : undefined,
    quantity,
  })
}

/**
 * The variant a product page shows (A3): the colour its address names, in the
 * size the shopper picked — or, until they pick one, the first size.
 * Mirrors the page's own choice of colour, price and sizes (src/pages/Product.jsx).
 */
export function viewedItem(product, routeId, chosenSize, { category } = {}) {
  if (!product) return null
  const colours = product.colors?.length > 1 ? product.colors : []
  const variant = variantFor(colours, routeId) || product
  const sizes = variant.sizes?.length ? variant.sizes : product.sizes || []
  return trackedItem({
    productId: variant.sku,
    groupId: designGroupId(variant),
    size: sizes.includes(chosenSize) ? chosenSize : sizes[0],
    name: product.title,
    colour: (colours.length ? variant.color : '') || product.colour,
    category,
    price: variant.price,
    compare: variant.compare,
    quantity: 1,
  })
}

/**
 * A cart line as an item. `quantity` overrides the line's own for
 * add_to_cart and remove_from_cart, which describe only the units added or
 * removed (A4, A5).
 */
export function cartLineItem(line, { category, quantity } = {}) {
  const row = line?.row || {}
  return trackedItem({
    productId: row.sku,
    groupId: designGroupId(row),
    size: line?.size,
    name: line?.product?.title,
    colour: line?.color || row.colour,
    category,
    price: line?.price,
    compare: row.compare,
    quantity: quantity ?? line?.qty,
  })
}

/**
 * An ordered line as an item: the Product ID, title and price the order
 * itself recorded, so the purchase names exactly what was bought. `row` is
 * the product's catalogue row, which names its design.
 */
export function orderLineItem(line, { category, compare, row } = {}) {
  return trackedItem({
    productId: line?.sku,
    groupId: row ? designGroupId(row) : undefined,
    size: line?.size,
    name: orderLineName(line?.title),
    colour: orderLineColour(line?.title),
    category,
    price: line?.unit_price,
    compare,
    quantity: Number(line?.qty) || 1,
  })
}

const valueOf = (items) => round(items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0))
const known = (items) => (items || []).filter(Boolean)

/**
 * view_item, add_to_cart, remove_from_cart, view_cart and begin_checkout
 * (A3–A7). `value` defaults to price × quantity over the items; begin_checkout
 * passes the total after a coupon instead, with the coupon's code. Null when
 * no item can be described.
 */
export function cartEvent(event, items, { eventId, value, coupon } = {}) {
  const list = known(items)
  if (!list.length) return null
  return compact({
    event,
    event_id: eventId,
    ecommerce: compact({
      currency: CURRENCY,
      value: amount(value) ?? valueOf(list),
      coupon: text(coupon),
      items: list,
    }),
  })
}

/**
 * add_shipping_info (A8): the checkout's address step. The customer's details
 * ride at the top level, so every later event of the visit carries them — this
 * is where a guest's details first reach GTM.
 */
export function shippingEvent({ items, customer, value, coupon, eventId } = {}) {
  const list = known(items)
  if (!list.length) return null
  return compact({
    event: 'add_shipping_info',
    event_id: eventId,
    ...customerFields(customer),
    ecommerce: compact({
      currency: CURRENCY,
      value: amount(value) ?? valueOf(list),
      coupon: text(coupon),
      shipping_tier: SHIPPING_TIER,
      items: list,
    }),
  })
}

/** add_payment_info (A9). `paymentType` only when it is one of the brief's values. */
export function paymentEvent({ items, value, coupon, paymentType, eventId } = {}) {
  const list = known(items)
  if (!list.length) return null
  return compact({
    event: 'add_payment_info',
    event_id: eventId,
    ecommerce: compact({
      currency: CURRENCY,
      value: amount(value) ?? valueOf(list),
      coupon: text(coupon),
      payment_type: PAYMENT_TYPES.has(paymentType) ? paymentType : undefined,
      items: list,
    }),
  })
}

/** The payment_type an order can name: cod for an offline order, else what the order records. */
export function orderPaymentType(order) {
  if (order?.payment_method === 'cod') return 'cod'
  return PAYMENT_TYPES.has(order?.payment_type) ? order.payment_type : undefined
}

// GST on clothing since 22 September 2025: 5% on a piece sold for up to
// ₹2,500 before GST — ₹2,625 with it — and 18% above that. Each piece is
// judged on its own selling price, not the bill.
const GST_LOW = 5
const GST_HIGH = 18
const GST_LOW_LIMIT = 2500 * (1 + GST_LOW / 100)
const gstRate = (pieceWithGst) => (pieceWithGst <= GST_LOW_LIMIT ? GST_LOW : GST_HIGH)
const gstIn = (amountWithGst, rate) => (amountWithGst * rate) / (100 + rate)

/**
 * The GST already inside what the customer paid (A10's `tax`): every price on
 * the site includes it. A coupon is shared across the lines in proportion to
 * their value before each piece's rate is decided, and shipping carries the
 * rate of the order's largest line. Undefined when there is nothing priced.
 */
export function orderTax(items, { discount = 0, shipping = 0 } = {}) {
  const lines = known(items)
    .map((i) => ({ value: (price(i.price) || 0) * (Number(i.quantity) || 1), quantity: Number(i.quantity) || 1 }))
    .filter((l) => l.value > 0)
  const goods = lines.reduce((sum, l) => sum + l.value, 0)
  if (!goods) return undefined
  const off = Math.min(Math.max(Number(discount) || 0, 0), goods)
  let tax = 0
  let main = null
  for (const line of lines) {
    const paid = line.value - off * (line.value / goods)
    const rate = gstRate(paid / line.quantity)
    tax += gstIn(paid, rate)
    if (!main || line.value > main.value) main = { value: line.value, rate }
  }
  if (Number(shipping) > 0) tax += gstIn(Number(shipping), main.rate)
  return round(tax)
}

/**
 * purchase (A10), from the order the payment confirmed.
 *
 * event_id and transaction_id are both the Order ID (`orders.reference`, the
 * DDMMYYNN number in the admin panel and the order email). value is what the
 * customer pays — products after every discount, plus shipping (brief
 * Section 8) — and shipping is also sent on its own. tax is the GST inside
 * that value (`orderTax`), for information only. The customer's details come
 * from the order, so a guest's purchase carries them too.
 *
 * payment_type and new_customer come from the server, which asks Razorpay how
 * the shopper paid and checks earlier orders; either is left out when the
 * order does not say. test_order is true only on an admin's test order
 * (Razorpay test mode, rule 10), so GTM can keep it away from the ad networks.
 */
export function purchaseEvent(order, items) {
  const list = known(items)
  const reference = text(String(order?.reference ?? ''))
  if (!reference || !list.length) return null
  const shipping = amount(order.shipping)
  const discount = amount(order.discount) || 0
  const total = amount(order.total) ?? round(Math.max(0, (amount(order.subtotal) ?? valueOf(list)) - discount + (shipping || 0)))
  const customer = order.customer || {}
  return compact({
    event: 'purchase',
    event_id: reference,
    new_customer: typeof order.new_customer === 'boolean' ? order.new_customer : undefined,
    test_order: order.is_test === true ? true : undefined,
    ...customerFields({
      email: order.email || customer.email,
      fullName: order.full_name || customer.full_name,
      phone: order.phone || customer.phone,
      city: order.city || customer.city,
      state: order.state || customer.state,
      pincode: order.pincode || customer.pincode,
    }),
    ecommerce: compact({
      transaction_id: reference,
      currency: CURRENCY,
      value: total,
      tax: amount(order.tax) ?? orderTax(list, { discount, shipping }),
      shipping,
      coupon: discount > 0 ? text(order.coupon_code) : undefined,
      payment_type: orderPaymentType(order),
      items: list,
    }),
  })
}

/** search (A13): the term exactly as typed, tidied of stray spaces. */
export function searchEvent(term, { eventId } = {}) {
  const searched = text(term)
  return searched ? compact({ event: 'search', event_id: eventId, search_term: searched }) : null
}

/** Two pushes of the same step with nothing new in them (a retry after the payment window was closed). */
export function sameStep(a, b) {
  if (!a || !b) return false
  const strip = ({ event_id: _ignored, ...rest }) => JSON.stringify(rest)
  return strip(a) === strip(b)
}
