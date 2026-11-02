// GTM's e-commerce events (tracking brief, Section 3 and Annexure A3–A13): the
// exact entries the site pushes, field for field and in the brief's order.
//
// The brief's example shopper runs through every step here, with one
// difference that is the brief's own Section 8 rule: IDs are the shop's own.
// Its Product ID names one colour (0101BU), so item_id adds the size
// (0101BU_M) and item_group_id names the design across its colours
// (kurtas_floral-anarkali-kurta-4b6a7e1f), where the brief's made-up example
// had RC-KUR-014_blue_M and RC-KUR-014.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BRAND,
  amount,
  cartEvent,
  cartLineItem,
  designGroupId,
  itemId,
  orderLineItem,
  orderTax,
  paymentEvent,
  price,
  purchaseEvent,
  sameStep,
  searchEvent,
  shippingEvent,
  trackedItem,
  viewedItem,
} from '../src/lib/trackingItems.js'

// The brief's two products, as the catalogue and the cart hold them.
const kurtaRow = { id: 'floral-anarkali-kurta-blue', sku: '0101BU', title: 'Floral Anarkali Kurta - Blue', type: 'kurtas', colour: 'Blue', price: 1299, compare: 1599, sizes: ['S', 'M', 'L'] }
const dupattaRow = { id: 'chiffon-dupatta-pink', sku: '0201PI', title: 'Chiffon Dupatta - Pink', type: 'dupattas', colour: 'Pink', price: 699, compare: null, sizes: ['Free size'] }
const kurtaDesign = { ...kurtaRow, title: 'Floral Anarkali Kurta' }
const dupattaDesign = { ...dupattaRow, title: 'Chiffon Dupatta' }

const kurtaItem = (quantity) => ({
  item_id: '0101BU_M',
  item_group_id: 'kurtas_floral-anarkali-kurta-4b6a7e1f',
  item_name: 'Floral Anarkali Kurta',
  item_brand: BRAND,
  item_category: 'Kurtas',
  item_variant: 'Blue / M',
  price: 1299,
  discount: 300,
  quantity,
})
const dupattaItem = {
  item_id: '0201PI_Free size',
  item_group_id: 'dupattas_chiffon-dupatta-243a44dd',
  item_name: 'Chiffon Dupatta',
  item_brand: BRAND,
  item_category: 'Dupattas',
  item_variant: 'Pink / Free size',
  price: 699,
  quantity: 1,
}

const cartLines = [
  { id: kurtaRow.id, size: 'M', qty: 2, color: 'Blue', price: 1299, product: kurtaDesign, row: kurtaRow },
  { id: dupattaRow.id, size: 'Free size', qty: 1, color: 'Pink', price: 699, product: dupattaDesign, row: dupattaRow },
]
const category = { kurtas: 'Kurtas', dupattas: 'Dupattas' }
const cartItems = cartLines.map((l) => cartLineItem(l, { category: category[l.row.type] }))

test('item_id is the Product ID and the size; nothing is made up when either is missing', () => {
  assert.equal(itemId('0101BU', 'M'), '0101BU_M')
  assert.equal(itemId(' 0101BU ', ' M '), '0101BU_M')
  assert.equal(itemId('', 'M'), undefined)
  assert.equal(itemId('0101BU', ''), undefined)
  // The bundled catalogue the page paints first has no Product IDs.
  assert.equal(trackedItem({ productId: '', size: 'M', name: 'X', price: 100 }), null)
})

test('item_group_id: one per design, shared by its colours; the site’s designs never merge', () => {
  const kurta = 'kurtas_floral-anarkali-kurta-4b6a7e1f'
  assert.equal(designGroupId(kurtaRow), kurta)
  assert.equal(designGroupId({ ...kurtaRow, id: 'floral-anarkali-kurta-red', sku: '0102RE', title: 'Floral Anarkali Kurta - Red', colour: 'Red' }), kurta)
  // The same name in another category is another design, and so is a name
  // that differs only in capitals: the site shows each as its own product.
  assert.notEqual(designGroupId({ ...kurtaRow, type: 'dress' }), kurta)
  assert.notEqual(designGroupId({ ...kurtaRow, title: 'Floral anarkali kurta - Blue' }), kurta)
  // A row that names no colour is a design of its own and keeps its Product ID.
  assert.equal(designGroupId({ sku: '0201WH', title: 'Plain Top', type: 'tops', colour: null }), '0201WH')
  // Long names stay inside Google's 50 characters, and apart.
  const long = (name) => designGroupId({ sku: '0901BL', title: `${name} - Black`, type: 'coord', colour: 'Black' })
  const a = long('Embroidered Cotton Kurti with Palazzo and Dupatta Set')
  const b = long('Embroidered Cotton Kurti with Palazzo and Dupatta Set Deluxe')
  assert.ok(a.length <= 50 && b.length <= 50)
  assert.notEqual(a, b)
})

test('item_group_id is the design ID the database stored, whenever the row has one', () => {
  assert.equal(designGroupId({ ...kurtaRow, design_id: '05-FAK-01' }), '05-FAK-01')
  // Renamed since: the stored ID still names the design.
  assert.equal(designGroupId({ ...kurtaRow, title: 'Linen Kurta - Blue', design_id: '05-FAK-01' }), '05-FAK-01')
  assert.equal(viewedItem({ ...kurtaDesign, design_id: '05-FAK-01' }, kurtaRow.id, 'M').item_group_id, '05-FAK-01')
})

test('prices are numbers; a missing or ₹0 price is left out, a ₹0 shipping is kept', () => {
  assert.equal(price('1299'), 1299)
  assert.equal(price(849.5), 849.5)
  assert.equal(price(0), undefined)
  assert.equal(price('₹1,299'), undefined)
  assert.equal(amount(0), 0)
  assert.equal(amount(null), undefined)
})

test('A3 view_item: the variant on screen, the first size until one is picked', () => {
  const design = { ...kurtaDesign, colors: [{ ...kurtaRow, color: 'Blue' }, { ...kurtaRow, id: 'floral-anarkali-kurta-red', sku: '0102RE', color: 'Red', price: 1199, compare: null, sizes: ['M', 'L'] }] }
  assert.equal(viewedItem(design, kurtaRow.id, null, { category: 'Kurtas' }).item_id, '0101BU_S')
  assert.deepEqual(viewedItem(design, kurtaRow.id, 'M', { category: 'Kurtas' }), kurtaItem(1))
  // Another colour is another row: its own ID, price and sizes, in the same
  // design group. A size it does not stock falls back to its first size.
  const red = viewedItem(design, 'floral-anarkali-kurta-red', 'S', { category: 'Kurtas' })
  assert.equal(red.item_id, '0102RE_M')
  assert.equal(red.item_group_id, kurtaItem(1).item_group_id)
  assert.equal(red.item_variant, 'Red / M')
  assert.equal(red.price, 1199)
  assert.equal(red.discount, undefined)

  const event = cartEvent('view_item', [kurtaItem(1)], { eventId: 'c1f6a2de-7b3e-4f0a-9d1c-5e8b2a4f6c01' })
  assert.deepEqual(event, {
    event: 'view_item',
    event_id: 'c1f6a2de-7b3e-4f0a-9d1c-5e8b2a4f6c01',
    ecommerce: { currency: 'INR', value: 1299, items: [kurtaItem(1)] },
  })
  assert.deepEqual(Object.keys(event), ['event', 'event_id', 'ecommerce'])
})

test('A4 add_to_cart: only the units just added, value = price × those units', () => {
  const added = cartLineItem(cartLines[0], { category: 'Kurtas', quantity: 2 })
  assert.deepEqual(cartEvent('add_to_cart', [added], { eventId: 'e2' }), {
    event: 'add_to_cart', event_id: 'e2',
    ecommerce: { currency: 'INR', value: 2598, items: [kurtaItem(2)] },
  })
})

test('A5 remove_from_cart: the units removed', () => {
  const removed = cartLineItem(cartLines[0], { category: 'Kurtas', quantity: 1 })
  assert.deepEqual(cartEvent('remove_from_cart', [removed], { eventId: 'e3' }).ecommerce, {
    currency: 'INR', value: 1299, items: [kurtaItem(1)],
  })
})

test('A6/A7 view_cart and begin_checkout: everything in the cart; the dupatta has no discount field', () => {
  assert.deepEqual(cartItems, [kurtaItem(2), dupattaItem])
  assert.equal('discount' in cartItems[1], false)
  for (const name of ['view_cart', 'begin_checkout']) {
    assert.deepEqual(cartEvent(name, cartItems, { eventId: 'e4' }), {
      event: name, event_id: 'e4',
      ecommerce: { currency: 'INR', value: 3297, items: [kurtaItem(2), dupattaItem] },
    })
  }
  // A coupon already applied: value is after it, and the code rides along.
  assert.deepEqual(cartEvent('begin_checkout', cartItems, { eventId: 'e5', value: 2967, coupon: 'DIWALI10' }).ecommerce, {
    currency: 'INR', value: 2967, coupon: 'DIWALI10', items: cartItems,
  })
})

test('nothing describable, no event', () => {
  assert.equal(cartEvent('view_cart', [], { eventId: 'x' }), null)
  assert.equal(cartEvent('view_cart', [null], { eventId: 'x' }), null)
})

const guest = { email: 'Priya@Example.com', fullName: 'Priya Sharma', phone: '98765 43210', city: 'Pune', state: 'Maharashtra', pincode: '411001' }
const customerFieldsA8 = {
  user_email: 'priya@example.com',
  user_phone: '+919876543210',
  user_first_name: 'priya',
  user_last_name: 'sharma',
  user_city: 'pune',
  user_state: 'maharashtra',
  user_zip: '411001',
  user_country: 'IN',
}

test('A8 add_shipping_info: the guest’s details at the top level, never inside items', () => {
  const event = shippingEvent({ items: cartItems, customer: guest, eventId: '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c04' })
  assert.deepEqual(event, {
    event: 'add_shipping_info',
    event_id: '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c04',
    ...customerFieldsA8,
    ecommerce: { currency: 'INR', value: 3297, shipping_tier: 'standard', items: cartItems },
  })
  assert.deepEqual(Object.keys(event), ['event', 'event_id', ...Object.keys(customerFieldsA8), 'ecommerce'])
  for (const item of event.ecommerce.items) {
    assert.equal(Object.keys(item).some((k) => k.startsWith('user_')), false)
  }
})

test('A9 add_payment_info: payment_type only when it is one of the brief’s values', () => {
  assert.deepEqual(paymentEvent({ items: cartItems, eventId: 'e6', paymentType: 'upi' }).ecommerce, {
    currency: 'INR', value: 3297, payment_type: 'upi', items: cartItems,
  })
  // Online payment: the method is chosen inside Razorpay's window, so it is left out.
  assert.equal('payment_type' in paymentEvent({ items: cartItems, eventId: 'e7' }).ecommerce, false)
  assert.equal('payment_type' in paymentEvent({ items: cartItems, eventId: 'e8', paymentType: 'online' }).ecommerce, false)
})

const orderLines = [
  { product_id: kurtaRow.id, title: 'Floral Anarkali Kurta - Blue', size: 'M', qty: 2, unit_price: 1299, sku: '0101BU' },
  { product_id: dupattaRow.id, title: 'Chiffon Dupatta - Pink', size: 'Free size', qty: 1, unit_price: 699, sku: '0201PI' },
]
const paidOrder = {
  reference: '18102601',
  payment_method: 'razorpay',
  payment_status: 'paid',
  subtotal: 3297,
  discount: 0,
  coupon_code: null,
  shipping: 0,
  total: 3297,
  email: 'priya@example.com',
  full_name: 'Priya Sharma',
  phone: '9876543210',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  items: orderLines,
}
const orderItems = [
  orderLineItem(orderLines[0], { category: 'Kurtas', compare: 1599, row: kurtaRow }),
  orderLineItem(orderLines[1], { category: 'Dupattas', compare: null, row: dupattaRow }),
]

test('order lines name what the order itself recorded', () => {
  assert.deepEqual(orderItems, [kurtaItem(2), dupattaItem])
  // A product gone from the catalogue still has a group: its Product ID.
  assert.equal(orderLineItem(orderLines[0], { category: 'Kurtas', compare: 1599 }).item_group_id, '0101BU')
})

test('A10 purchase: event_id and transaction_id are the Order ID; details come from the order', () => {
  const event = purchaseEvent(paidOrder, orderItems)
  assert.deepEqual(event, {
    event: 'purchase',
    event_id: '18102601',
    ...customerFieldsA8,
    ecommerce: {
      transaction_id: '18102601',
      currency: 'INR',
      value: 3297,
      tax: 157,
      shipping: 0,
      items: [kurtaItem(2), dupattaItem],
    },
  })
  // Not on the order, so not guessed: the online payment's method, whether
  // this customer ever ordered before, and a test flag on a real order.
  assert.equal('payment_type' in event.ecommerce, false)
  assert.equal('new_customer' in event, false)
  assert.equal('test_order' in event, false)
})

test('tax is the GST inside the price: 5% up to ₹2,500 a piece before GST, 18% above', () => {
  // The brief's own example: ₹3,346 with ₹49 shipping holds ₹159.33 of GST.
  assert.equal(purchaseEvent({ ...paidOrder, shipping: 49, total: 3346 }, orderItems).ecommerce.tax, 159.33)
  const piece = (unit, quantity = 1) => [trackedItem({ productId: '0101BU', size: 'M', name: 'X', price: unit, quantity })]
  assert.equal(orderTax(piece(849)), 40.43)
  assert.equal(orderTax(piece(2625)), 125)
  assert.equal(orderTax(piece(3000)), 457.63)
  // A coupon is shared across the lines before each piece's rate is decided:
  // ₹2,800 less ₹300 is ₹2,500 a piece, inside the 5% band.
  assert.equal(orderTax(piece(2800), { discount: 300 }), 119.05)
  assert.equal(orderTax([]), undefined)
})

test('an admin’s test order says so; a real one never carries the flag', () => {
  assert.equal(purchaseEvent({ ...paidOrder, is_test: true }, orderItems).test_order, true)
  assert.equal('test_order' in purchaseEvent({ ...paidOrder, is_test: false }, orderItems), false)
})

test('purchase value is what the customer paid: after the coupon, plus shipping', () => {
  const withCoupon = purchaseEvent({ ...paidOrder, discount: 329, coupon_code: 'DIWALI10', total: 2968 }, orderItems)
  assert.equal(withCoupon.ecommerce.value, 2968)
  assert.equal(withCoupon.ecommerce.coupon, 'DIWALI10')
  const shipped = purchaseEvent({ ...paidOrder, shipping: 49, total: 3346 }, orderItems)
  assert.equal(shipped.ecommerce.value, 3346)
  assert.equal(shipped.ecommerce.shipping, 49)
  // A coupon code without a discount was not used.
  assert.equal('coupon' in purchaseEvent({ ...paidOrder, coupon_code: 'OLD' }, orderItems).ecommerce, false)
})

test('a COD order names its payment type, and an order’s own facts are used when it has them', () => {
  assert.equal(purchaseEvent({ ...paidOrder, payment_method: 'cod', payment_status: 'pending' }, orderItems).ecommerce.payment_type, 'cod')
  const later = purchaseEvent({ ...paidOrder, payment_type: 'upi', tax: 157, new_customer: true }, orderItems)
  assert.equal(later.ecommerce.payment_type, 'upi')
  assert.equal(later.ecommerce.tax, 157)
  assert.equal(later.new_customer, true)
})

test('a guest order’s details come from what was typed at checkout', () => {
  const { email, full_name: _n, phone, city, state, pincode, ...rest } = paidOrder
  const event = purchaseEvent({ ...rest, customer: { email, full_name: 'Priya Sharma', phone, city, state, pincode } }, orderItems)
  assert.equal(event.user_email, 'priya@example.com')
  assert.equal(event.user_first_name, 'priya')
})

test('A13 search: the term as typed, tidied', () => {
  assert.deepEqual(searchEvent('  anarkali   kurta ', { eventId: 'e9' }), {
    event: 'search', event_id: 'e9', search_term: 'anarkali kurta',
  })
  assert.equal(searchEvent('   ', { eventId: 'e9' }), null)
})

test('a repeated checkout step with nothing new is recognised; any change is a new step', () => {
  const a = shippingEvent({ items: cartItems, customer: guest, eventId: 'one' })
  assert.equal(sameStep(a, shippingEvent({ items: cartItems, customer: guest, eventId: 'two' })), true)
  assert.equal(sameStep(a, shippingEvent({ items: cartItems, customer: { ...guest, city: 'Mumbai' }, eventId: 'three' })), false)
  assert.equal(sameStep(null, a), false)
})

test('numbers are numbers and nothing is ever blank, null or "undefined" (Annexure A, rules 5, 6 and 8)', () => {
  const all = [
    cartEvent('view_cart', cartItems, { eventId: 'a' }),
    shippingEvent({ items: cartItems, customer: guest, eventId: 'b' }),
    paymentEvent({ items: cartItems, eventId: 'c' }),
    purchaseEvent(paidOrder, orderItems),
  ]
  const walk = (value) => {
    if (value && typeof value === 'object') return Object.values(value).forEach(walk)
    assert.notEqual(value, '')
    assert.notEqual(value, null)
    assert.notEqual(value, undefined)
    assert.notEqual(value, 'undefined')
  }
  all.forEach(walk)
  for (const event of all) {
    assert.equal(typeof event.ecommerce.value, 'number')
    for (const item of event.ecommerce.items) {
      assert.equal(typeof item.price, 'number')
      assert.equal(typeof item.quantity, 'number')
      assert.equal(typeof item.item_id, 'string')
    }
  }
})
