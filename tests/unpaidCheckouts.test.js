// Unpaid checkouts, 12 Nov 2026 (change 4 of the checkout plan): checkout
// records a valid mobile number with the cart, and the admin's list shows who
// left without paying, with a WhatsApp message about that cart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { leadItems, leadSource } from '../src/lib/leadRules.js'
import { cartLines, phoneText, shopperWhatsAppLink, sourceLabel } from '../src/admin/unpaidCheckouts.js'
import { contactMethod } from '../src/lib/trackingItems.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const SQL = read('supabase/migrations/20261112200000_checkout_leads.sql')
const CHECKOUT = read('src/pages/Checkout.jsx')

// ---- what checkout sends ----------------------------------------------------

test('only product IDs, sizes and quantities leave checkout, never what was typed', () => {
  const lines = [{ id: 'solid-shirt-and-pant-combo-bright-red', size: 'L', qty: 1, color: 'Bright Red', product: { title: 'Solid' }, price: 849 }]
  assert.deepEqual(leadItems(lines), [{ product_id: 'solid-shirt-and-pant-combo-bright-red', size: 'L', qty: 1 }])
})

test('the ad source keeps campaign tags and whether a Meta or Google click came first, not the click IDs', () => {
  const source = leadSource({ utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'Sales_CoordSets', utm_content: 'Ad3_Prathyu_NavyCoord', fbc: 'fb.1.123.abc', fbp: 'fb.1.9', gclid: '', landing_page: '/product/x' })
  assert.deepEqual(source, { utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'Sales_CoordSets', utm_content: 'Ad3_Prathyu_NavyCoord', has_meta_click: true, has_google_click: false })
  assert.doesNotMatch(JSON.stringify(source), /fb\.1|landing/)
  assert.deepEqual(leadSource({ gclid: 'x' }), { has_meta_click: false, has_google_click: true })
  assert.deepEqual(leadSource(null), { has_meta_click: false, has_google_click: false })
})

test('checkout records the number once it is valid and the cart has something, after a pause, never for admins', () => {
  assert.match(CHECKOUT, /const leadKey = !isAdmin && lines\.length && mobileOk\(f\.phone\)/)
  assert.match(CHECKOUT, /if \(!leadKey \|\| leadSent\.current === leadKey\) return undefined/)
  assert.match(CHECKOUT, /saveCheckoutLead\(\{\s*phone: leadKey\.split\('\|'\)\[0\],\s*items: leadItems\(latestLines\.current\),\s*source: leadSource\(attributionForOrder\(\)\),/)
  assert.match(CHECKOUT, /\}, 800\)/)
  assert.match(CHECKOUT, /hint="For order updates only\. No spam, promise\."/, 'the notice is still beside the field')
  const lib = read('src/lib/checkoutLeads.js')
  assert.match(lib, /supabase\.rpc\('save_checkout_lead', \{ p_phone: phone, p_items: items, p_source: source \|\| \{\} \}\)/)
  assert.match(lib, /catch \{/, 'an error never reaches the shopper')
})

// ---- the database --------------------------------------------------------------

test('only admins can read or delete; shoppers can only add through the function', () => {
  assert.match(SQL, /alter table public\.checkout_leads enable row level security;/)
  assert.match(SQL, /revoke all on table public\.checkout_leads from anon, authenticated;/)
  assert.match(SQL, /grant select, delete on table public\.checkout_leads to authenticated;/)
  assert.match(SQL, /for select to authenticated\s+using \(public\.is_admin\(\)\)/)
  assert.match(SQL, /for delete to authenticated\s+using \(public\.is_admin\(\)\)/)
  assert.doesNotMatch(SQL, /for (insert|update)/, 'no direct writes for anyone')
  assert.match(SQL, /grant execute on function public\.save_checkout_lead\(text, jsonb, jsonb\) to anon, authenticated;/)
  assert.match(SQL, /revoke all on function public\.admin_checkout_leads\(integer\) from public, anon, authenticated, service_role;/)
  assert.match(SQL, /grant execute on function public\.admin_checkout_leads\(integer\) to authenticated;/)
  assert.match(SQL, /if not public\.is_admin\(\) then\s+raise exception/)
})

test('the function keeps a real mobile number and real products only, with a daily cap', () => {
  assert.match(SQL, /phone\s+text primary key check \(phone ~ '\^\[6-9\]\[0-9\]\{9\}\$'\)/)
  assert.match(SQL, /if v_phone !~ '\^\[6-9\]\[0-9\]\{9\}\$' then\s+return;/)
  assert.match(SQL, /join public\.products p on p\.id = i\.product_id;/)
  assert.match(SQL, /where e\.n <= 20/)
  assert.match(SQL, /least\(greatest\(\(e\.x->>'qty'\)::integer, 1\), 10\)/)
  assert.match(SQL, />= 2000 then\s+return;/)
  assert.match(SQL, /on conflict \(phone\) do update set/)
  assert.doesNotMatch(SQL, /exception when others/, 'errors are not hidden in the database')
  assert.doesNotMatch(SQL, /fbc|fbp|gclid|email|full_name|address/, 'no click IDs or other personal details are stored')
})

test('"Paid" means a real paid order from that number since the last visit to checkout', () => {
  assert.match(SQL, /right\(regexp_replace\(o\.phone, '\\D', '', 'g'\), 10\) = l\.phone/)
  assert.match(SQL, /and o\.payment_status = 'paid'/)
  assert.match(SQL, /and not o\.is_test/)
  assert.match(SQL, /and o\.created_at >= l\.last_seen_at - interval '10 minutes'/)
})

// ---- the admin's list -----------------------------------------------------------

const row = {
  phone: '9876543210',
  items: [{ title: 'Solid Shirt and Pant Combo', colour: 'Bright Red', size: 'L', qty: 1, price: 849 }, { title: 'Kurta', size: 'M', qty: 2, price: 700 }],
  utm_source: 'ig', utm_content: 'Ad3_Prathyu_NavyCoord', has_meta_click: true,
}

test('the cart reads as lines, the number the Indian way', () => {
  assert.deepEqual(cartLines(row.items), ['1 × Solid Shirt and Pant Combo – Bright Red, size L (₹849)', '2 × Kurta – size M (₹1,400)'])
  assert.deepEqual(cartLines(null), [])
  assert.equal(phoneText('9876543210'), '+91 98765 43210')
})

test('where shoppers came from', () => {
  assert.equal(sourceLabel(row), 'Meta ad · Ad3_Prathyu_NavyCoord')
  assert.equal(sourceLabel({ has_meta_click: true }), 'Meta ad')
  assert.equal(sourceLabel({ utm_source: 'facebook', utm_campaign: 'Sales' }), 'Meta ad · Sales')
  assert.equal(sourceLabel({ has_google_click: true, utm_campaign: 'Brand' }), 'Google · Brand')
  assert.equal(sourceLabel({ utm_source: 'newsletter' }), 'newsletter')
  assert.equal(sourceLabel({}), 'Direct or unknown')
})

test('WhatsApp opens a chat with the shopper about their cart, and nothing else', () => {
  const href = shopperWhatsAppLink(row)
  assert.ok(href.startsWith('https://wa.me/919876543210?text='))
  assert.equal(contactMethod(href), 'whatsapp')
  assert.equal(
    decodeURIComponent(href.split('?text=')[1]),
    'Hi, this is Ruhi Collections. You were checking out with us:\n' +
    '• 1 × Solid Shirt and Pant Combo – Bright Red, size L (₹849)\n' +
    '• 2 × Kurta – size M (₹1,400)\n' +
    'Can we help you complete your order? If you have any questions about the size or delivery, just reply here.',
  )
})

test('the dashboard has the section beside Orders, and deleting takes two taps', () => {
  const dashboard = read('src/admin/Dashboard.jsx')
  assert.match(dashboard, /\['orders', 'Orders'\], \['unpaid', 'Unpaid checkouts'\]/)
  assert.match(dashboard, /\{section === 'unpaid' && <UnpaidCheckoutsPanel notify=\{notify\} \/>\}/)
  const panel = read('src/admin/UnpaidCheckoutsPanel.jsx')
  assert.match(panel, /supabase\.rpc\('admin_checkout_leads', \{ p_limit: 300 \}\)/)
  assert.match(panel, /supabase\.from\('checkout_leads'\)\.delete\(\)\.eq\('phone', phone\)/)
  assert.match(panel, /if \(armed !== phone\) \{\s+setArmed\(phone\)\s+return\s+\}/)
})
