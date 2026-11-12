// Checkout layout, 12 Nov 2026 (change 2 of the checkout plan): a focused page
// with its own header and "Chat with us", the order on top with the delivery
// dates, a coupon link only while a coupon is live, ticks and an email typo
// check, reassurance under Pay and a Pay bar on phones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deliveryWindowText } from '../src/lib/delivery.js'
import { suggestEmail } from '../src/lib/emailTypos.js'
import { checkoutWhatsAppLink } from '../src/lib/whatsapp.js'
import { contactEvent, contactMethod } from '../src/lib/trackingItems.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CHECKOUT = read('src/pages/Checkout.jsx')
const LAYOUT = read('src/components/Layout.jsx')
const HEADER = read('src/components/CheckoutHeader.jsx')
const SITE = read('src/data/site.js')

// ---- delivery dates ---------------------------------------------------------

test('the window opens 7 working days (Mon–Sat) after the order and lasts 7 days', () => {
  // Thursday 12 Nov 2026, 10:00 in India: the owner's own example.
  assert.equal(deliveryWindowText(new Date('2026-11-12T04:30:00Z')), 'Fri 20 – Fri 27 Nov')
  // A Sunday order: Sunday itself never counts.
  assert.equal(deliveryWindowText(new Date('2026-11-15T06:00:00Z')), 'Mon 23 – Mon 30 Nov')
  // A window that crosses a month names both months.
  assert.equal(deliveryWindowText(new Date('2026-11-20T06:00:00Z')), 'Sat 28 Nov – Sat 5 Dec')
  // And a year.
  assert.equal(deliveryWindowText(new Date('2026-12-24T06:00:00Z')), 'Fri 1 – Fri 8 Jan')
})

test('days are counted in India, whatever the phone says', () => {
  // 23:30 in India on Thu 12 Nov, and 00:30 on Fri 13 Nov.
  assert.equal(deliveryWindowText(new Date('2026-11-12T18:00:00Z')), 'Fri 20 – Fri 27 Nov')
  assert.equal(deliveryWindowText(new Date('2026-11-12T19:00:00Z')), 'Sat 21 – Sat 28 Nov')
})

// ---- "Did you mean …?" ------------------------------------------------------

test('a one-letter slip in a big mail provider is caught', () => {
  assert.equal(suggestEmail('priya@gmial.com'), 'priya@gmail.com', 'swapped letters')
  assert.equal(suggestEmail('priya@gmail.con'), 'priya@gmail.com')
  assert.equal(suggestEmail(' Priya@GMAIL.CO '), 'Priya@gmail.com', 'the name part is kept as typed')
  assert.equal(suggestEmail('priya@gmai.com'), 'priya@gmail.com', 'a missing letter')
  assert.equal(suggestEmail('priya@yaho.co.in'), 'priya@yahoo.co.in')
  assert.equal(suggestEmail('priya@hotmial.com'), 'priya@hotmail.com')
  assert.equal(suggestEmail('priya@outlok.com'), 'priya@outlook.com')
  assert.equal(suggestEmail('priya@rediffmial.com'), 'priya@rediffmail.com')
  assert.equal(suggestEmail('priya@gmail'), 'priya@gmail.com', 'a missing .com')
})

test('real addresses are left alone', () => {
  for (const ok of ['priya@gmail.com', 'priya@yahoo.co.in', 'priya@mail.com', 'priya@email.com',
    'priya@company.co.in', 'priya@aon.com', 'priya@iitb.ac.in', 'priya@mi.com']) {
    assert.equal(suggestEmail(ok), null, ok)
  }
  for (const unfinished of ['', 'priya', 'priya@', '@gmail.com', undefined]) {
    assert.equal(suggestEmail(unfinished), null, String(unfinished))
  }
})

test('the suggestion waits until the shopper leaves the field, and one tap takes it', () => {
  assert.match(CHECKOUT, /valid=\{ok\('email'\) && !emailSuggestion\}/, 'no tick while a fix is offered')
  assert.match(CHECKOUT, /const emailSuggestion = emailLeft \? suggestEmail\(f\.email\) : null/)
  assert.match(CHECKOUT, /onFocus=\{\(\) => setEmailLeft\(false\)\} onBlur=\{\(\) => setEmailLeft\(true\)\}/)
  assert.match(CHECKOUT, /Did you mean <b[^>]*>\{emailSuggestion\}<\/b>\?/)
})

// ---- WhatsApp ---------------------------------------------------------------

test('"Chat with us" opens WhatsApp with the cart written out', () => {
  const href = checkoutWhatsAppLink({
    number: '919046651272',
    lines: [{ title: 'Solid Shirt and Pant Combo', color: 'Dark Navy Blue', size: 'L', qty: 1, amount: '₹849' }],
    total: '₹849',
  })
  assert.ok(href.startsWith('https://wa.me/919046651272?text='))
  assert.equal(contactMethod(href), 'whatsapp')
  assert.equal(
    decodeURIComponent(href.split('?text=')[1]),
    "Hi Ruhi Collections! I'm at checkout and have a question before paying.\n" +
    'My cart: 1 × Solid Shirt and Pant Combo – Dark Navy Blue, size L (₹849).\n' +
    'Total: ₹849',
  )
})

test('a long cart lists five items and counts the rest; an empty one just says hello', () => {
  const lines = Array.from({ length: 7 }, (_, i) => ({ title: `Kurta ${i + 1}`, size: 'M', qty: 1, amount: '₹700' }))
  const text = decodeURIComponent(checkoutWhatsAppLink({ number: '91', lines, total: '₹4,900' }).split('?text=')[1])
  assert.match(text, /^My cart:$/m)
  assert.equal((text.match(/^• /gm) || []).length, 6, 'five items plus the "and 2 more" line')
  assert.match(text, /• and 2 more items/)
  assert.match(text, /Total: ₹4,900$/)
  const empty = decodeURIComponent(checkoutWhatsAppLink({ number: '91', lines: [], total: '' }).split('?text=')[1])
  assert.equal(empty, "Hi Ruhi Collections! I'm at checkout and have a question before paying.")
})

test('a tap on "Chat with us" is GA4\'s contact event, never the number or the cart', () => {
  const tap = contactEvent('https://wa.me/919046651272?text=Hi', { location: 'checkout_whatsapp_button', eventId: 'w1' })
  assert.deepEqual(tap, { event: 'contact', event_id: 'w1', event_params: { method: 'whatsapp', link_location: 'checkout_whatsapp_button' } })
  assert.match(CHECKOUT, /contactEvent\(chatHref, \{ location: 'checkout_whatsapp_button', eventId: newEventId\(\) \}\)/)
})

test('the header button says "Chat with us" over the hours, in WhatsApp green', () => {
  assert.match(HEADER, />Chat with us</)
  assert.match(HEADER, /\{site\.supportHours\}/)
  assert.match(HEADER, /bg-\[#0A8040\]/)
  assert.match(HEADER, /aria-label=\{`Chat with us on WhatsApp, \$\{site\.supportHours\}`\}/)
  assert.match(HEADER, /to="\/cart" aria-label="Back to cart"/)
  assert.match(CHECKOUT, /<CheckoutHeader chatHref=\{chatHref\} onChat=\{chatTapped\} \/>/)
})

test('support hours are 9 AM – 9 PM everywhere the site states them', () => {
  assert.match(SITE, /supportHours: '9 AM – 9 PM'/)
  assert.match(SITE, /hours: '9 AM – 9 PM IST'/)
  assert.match(SITE, /'Secure Customer Support \(9am - 9pm\)'/)
  assert.match(SITE, /text: '9am - 9pm'/)
  assert.doesNotMatch(SITE, /10am|7pm|19:00/)
})

test('the product page\'s WhatsApp button no longer waits 8 seconds', () => {
  const button = read('src/components/WhatsAppButton.jsx')
  assert.doesNotMatch(button, /setTimeout|DELAY_MS|sessionStorage/)
})

// ---- a focused page -----------------------------------------------------------

test('checkout has no announcement strip, menus or footer; every other page keeps them', () => {
  assert.match(LAYOUT, /const focused = pathname\.replace\(\/\\\/\+\$\/, ''\) === '\/checkout'/)
  assert.match(LAYOUT, /\{!focused && <AnnouncementBar \/>\}/)
  assert.match(LAYOUT, /\{!focused && <Header \/>\}/)
  assert.match(LAYOUT, /\{!focused && <Footer \/>\}/)
  assert.match(LAYOUT, /<PaymentRecovery \/>/, 'payment recovery still runs on every page')
})

test('every state of the page keeps the slim header, so there is always a way back', () => {
  const headers = CHECKOUT.match(/\{header\}/g) || []
  assert.equal(headers.length, 4, 'error, loading, empty cart and the checkout itself')
})

// ---- the order box ------------------------------------------------------------

test('the total says nothing is added later, and the delivery dates sit under it', () => {
  assert.match(CHECKOUT, /· taxes included, no extra charges/)
  assert.match(CHECKOUT, /delivery=\{deliveryWindowText\(\)\}/)
  assert.match(CHECKOUT, /arrives <b[^>]*>\{delivery\}<\/b>/)
  assert.match(CHECKOUT, /'UPI, cards & net banking · secured by Razorpay'/)
})

test('"Have a coupon?" shows only while a coupon is live, behind a link', () => {
  assert.match(CHECKOUT, /couponsAvailable\(\)\.then\(\(yes\) => \{ if \(alive\) setCouponsLive\(yes\) \}\)/)
  assert.match(CHECKOUT, /\(coupon \|\| couponsLive \|\| couponNote\) && \(/)
  assert.match(CHECKOUT, /: couponsLive \? \(/)
  assert.match(CHECKOUT, />\s*Have a coupon\?\s*</)
  const coupons = read('src/lib/coupons.js')
  assert.match(coupons, /supabase\.rpc\('coupons_available'\)/)
  assert.match(coupons, /return !error && data === true/, 'a failed check keeps the link hidden')
})

test('the coupon check reveals yes or no and nothing else', () => {
  const sql = read('supabase/migrations/20261112160000_coupons_available.sql')
  assert.match(sql, /create or replace function public\.coupons_available\(\)\s+returns boolean/)
  assert.match(sql, /security definer set search_path = public, pg_temp/)
  assert.match(sql, /select exists \(/)
  assert.match(sql, /c\.is_active/)
  assert.match(sql, /c\.starts_at is null or c\.starts_at <= now\(\)/)
  assert.match(sql, /c\.ends_at\s+is null or c\.ends_at\s+>\s+now\(\)/)
  assert.match(sql, /revoke all on function public\.coupons_available\(\) from public, anon, authenticated, service_role;/)
  assert.match(sql, /grant execute on function public\.coupons_available\(\) to anon, authenticated;/)
})

// ---- the form -----------------------------------------------------------------

test('phone first, with what it is for; email says why it is asked', () => {
  const order = ['name="phone"', 'name="full_name"', 'name="email"', 'name="pincode"', 'name="city"', 'name="state"', 'name="address"']
  const at = order.map((n) => CHECKOUT.indexOf(n))
  assert.ok(at.every((i) => i > 0), 'every field is on the page')
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in this order')
  assert.match(CHECKOUT, /hint="For order updates only\. No spam, promise\."/)
  assert.match(CHECKOUT, /· for your receipt/)
  assert.match(CHECKOUT, /const FIELD_ORDER = \['phone', 'full_name', 'email', 'pincode', 'city', 'state', 'address', 'note'\]/)
  assert.match(CHECKOUT, /const firstBad = FIELD_ORDER\.find\(\(k\) => found\[k\]\)/, 'a failed Pay goes to the first problem on screen')
})

test('a tick shows exactly when Pay would accept the field', () => {
  assert.match(CHECKOUT, /const problems = validateAddress\(f\)/)
  assert.match(CHECKOUT, /const ok = \(k\) => !problems\[k\]/)
  assert.match(CHECKOUT, /\{valid && !error && \(/)
})

test('the delivery note is folded away until asked for', () => {
  assert.match(CHECKOUT, /\+ Add delivery note/)
  assert.match(CHECKOUT, /\{noteOpen \|\| f\.note \? \(/)
})

// ---- Pay ----------------------------------------------------------------------

test('Pay says the amount and that it is secure; reassurance and the seller sit under it', () => {
  assert.match(CHECKOUT, /`Pay \$\{inr\(total\)\} securely`/)
  assert.match(CHECKOUT, /<ShopRatingNote align="start" \/>/)
  assert.match(CHECKOUT, /Damaged or wrong item\? We'll replace it or refund you\./)
  assert.match(CHECKOUT, /Sold by <b[^>]*>\{site\.seller\.name\}<\/b>, \{site\.seller\.city\} · GSTIN \{site\.seller\.gstin\}/)
  assert.match(SITE, /seller: \{ name: 'Ruhi Collections', city: 'Bengaluru', gstin: '29CMOPN3041A1Z6' \}/)
  assert.match(read('src/components/Footer.jsx'), /Sold by \{site\.seller\.name\}, \{site\.seller\.city\} · GSTIN \{site\.seller\.gstin\}/)
})

test('the phone Pay bar submits the same form and steps aside while typing', () => {
  assert.match(CHECKOUT, /<form id="checkout-form" onSubmit=\{submit\}/)
  assert.match(CHECKOUT, /type="submit"\s+form="checkout-form"/)
  assert.match(CHECKOUT, /const showPayBar = !payInView && !typing && !awaitingPayment && lines\.length > 0 && onlinePaymentReady/)
  assert.match(CHECKOUT, /entry\.intersectionRatio >= 0\.6/)
  assert.match(CHECKOUT, /document\.addEventListener\('focusin', onIn\)/)
  assert.match(CHECKOUT, /className="lg:hidden fixed inset-x-0 bottom-0/)
})

test('policy links open in a new tab, so nothing typed is lost', () => {
  assert.match(CHECKOUT, /to="\/policies\/terms-of-service" target="_blank" rel="noopener"/)
  assert.match(CHECKOUT, /to="\/policies\/refund-policy" target="_blank" rel="noopener"/)
})

test('the one-choice "Payment" section and the sign-in detour are gone', () => {
  assert.doesNotMatch(CHECKOUT, /PayOption|role="radiogroup"|Already have an account/)
})
