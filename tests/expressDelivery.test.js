// Express delivery by air (19 Nov 2026). The owner's rules: standard delivery
// stays free; Express is optional, sent by air, arrives within 4 days of the
// order with every day counted, costs ₹149 per item and is never discounted by
// a coupon; every PIN code can have it (and nothing says otherwise); the ₹149
// is not refunded when an Express order is returned; the dashboard has a
// switch to pause it; and an Express order is unmissable in the dashboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  EXPRESS, EXPRESS_DAYS, EXPRESS_FEE_PER_ITEM, STANDARD, expressByDate, shippingFor, totalFor,
} from '../src/lib/pricing.js'
import { deliveryWindowText, expressArrivalText } from '../src/lib/delivery.js'
import { shippingEvent } from '../src/lib/trackingItems.js'
import { EXPORT_COLUMNS, ordersToRows } from '../src/admin/orderExport.js'
import {
  buildConfirmationText, buildOwnerNotificationSubject, buildOwnerNotificationText, expressByText, isExpress,
} from '../supabase/functions/_shared/orderEmail.mjs'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const DIR = path.join(process.cwd(), 'supabase/migrations')
const FILE = '20261119120000_express_delivery.sql'
const SQL = read(`supabase/migrations/${FILE}`)
const START = 'create or replace function public.create_order(payload json)'

/** A function's code inside a migration: comments and blank lines gone. */
function codeOf(file, start = START) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n')
  const s = lines.findIndex((l) => l.startsWith(start))
  const e = lines.findIndex((l, i) => i > s && l === 'end $$;')
  assert.ok(s !== -1 && e !== -1, `${start} is defined and closed in ${file}`)
  return lines.slice(s, e + 1).map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)
}

/** Lines in `a` that `b` lacks, counted. */
function minus(a, b) {
  const left = new Map()
  for (const l of b) left.set(l, (left.get(l) || 0) + 1)
  const out = []
  for (const l of a) {
    if (left.get(l)) left.set(l, left.get(l) - 1)
    else out.push(l)
  }
  return out
}

// ---- price -------------------------------------------------------------------

test('standard delivery is free; Express is ₹149 for every item, and no coupon touches it', () => {
  assert.equal(EXPRESS_FEE_PER_ITEM, 149)
  assert.equal(shippingFor(), 0)
  assert.equal(shippingFor(STANDARD, 3), 0)
  assert.equal(shippingFor(EXPRESS, 1), 149)
  assert.equal(shippingFor(EXPRESS, 2), 298)
  assert.equal(shippingFor(EXPRESS, 0), 0)
  // The coupon comes off the products; delivery is added after it.
  assert.equal(totalFor(849, 0, 149), 998)
  assert.equal(totalFor(1698, 150, 298), 1846)
  assert.equal(totalFor(849, 9999, 149), 149, 'a discount can never eat into the delivery charge')
  assert.equal(totalFor(1000, 100), 900, 'standard orders are priced as before')
})

test('the browser and the database charge the same ₹149 per item', () => {
  const recalc = codeOf(FILE, 'create or replace function public.recalc_order_totals(p_order uuid)').join('\n')
  assert.ok(recalc.includes(`v_ship := ${EXPRESS_FEE_PER_ITEM} * coalesce(v_pieces, 0);`))
  assert.ok(recalc.includes("if v_speed = 'express' then"))
  assert.ok(recalc.includes('select coalesce(sum(qty * unit_price), 0), coalesce(sum(qty), 0) into v_sub, v_pieces'))
  assert.ok(recalc.includes('shipping   = v_ship,'))
  assert.ok(recalc.includes('total      = v_sub - v_disc + v_ship,'))
})

// ---- dates -------------------------------------------------------------------

test('Express arrives within 4 days of the order, every day counted, in India', () => {
  assert.equal(EXPRESS_DAYS, 4)
  // Thursday 19 Nov, 10:00 in India → by Monday 23 Nov (Sunday counts).
  assert.equal(expressArrivalText(new Date('2026-11-19T04:30:00Z')), 'Mon 23 Nov')
  // 00:10 on Friday 20 Nov in India, though still the 19th in UTC.
  assert.equal(expressArrivalText(new Date('2026-11-19T18:40:00Z')), 'Tue 24 Nov')
  // Across a month.
  assert.equal(expressArrivalText(new Date('2026-11-28T06:00:00Z')), 'Wed 2 Dec')
  // The free window is unchanged.
  assert.equal(deliveryWindowText(new Date('2026-11-12T04:30:00Z')), 'Fri 20 – Fri 27 Nov')
  // The thank-you page and My orders use the browser's own formatting.
  assert.equal(expressByDate('2026-11-19T04:30:00Z'), 'Mon 23 Nov')
  assert.equal(expressByDate('2026-11-19T18:40:00Z'), 'Tue 24 Nov')
  assert.equal(expressByDate('not a date'), '')
  // So does the email, counted the same way.
  assert.equal(expressByText('2026-11-19T04:30:00Z'), 'Mon 23 Nov')
  assert.equal(expressByText(null), '')
})

// ---- database ----------------------------------------------------------------

test('this migration holds the create_order that runs: the newest definition', () => {
  const definers = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').some((l) => l.startsWith(START)))
  assert.equal(definers.at(-1), FILE)
})

test('create_order changes only by the delivery choice', () => {
  const previous = codeOf('20261106090000_online_payment_only.sql')
  const current = codeOf(FILE)
  assert.deepEqual(minus(previous, current).sort(), [
    "address, city, state, pincode, note, payment_method, coupon_code",
    "btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, v_pay, v_coupon",
  ].sort())
  assert.deepEqual(minus(current, previous).sort(), [
    "'delivery_speed',  v_order.delivery_speed,",
    "address, city, state, pincode, note, payment_method, coupon_code, delivery_speed",
    "btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, v_pay, v_coupon, v_speed",
    "delivery_speed = v_speed,",
    "delivery_speed = v_speed,",
    "end if;",
    "end if;",
    "if v_speed = 'express' and not coalesce((select s.express_delivery from public.shop_settings s where s.id), false) then",
    "if v_speed not in ('standard', 'express') then",
    "raise exception 'Express delivery is paused right now. Please choose free standard delivery and try again.';",
    "raise exception 'Please choose a delivery option.';",
    "v_speed    text  := coalesce(nullif(lower(btrim(coalesce(payload ->> 'delivery_speed', ''))), ''), 'standard');",
  ].sort())
})

test('the grants on create_order are restated exactly as before', () => {
  assert.ok(SQL.includes('revoke all on function public.create_order(json) from public, anon, authenticated, service_role;'))
  assert.ok(SQL.includes('grant execute on function public.create_order(json) to anon, authenticated;'))
  // recalc_order_totals keeps the revoke of 20261019160000: replacing a
  // function keeps its privileges, and nothing here grants it.
  assert.ok(!/grant[^;]*recalc_order_totals/i.test(SQL))
})

test('every order has a delivery option, standard by default, fixed once placed', () => {
  assert.match(SQL, /add column if not exists delivery_speed text not null default 'standard';/)
  assert.match(SQL, /check \(delivery_speed in \('standard', 'express'\)\)/)
  assert.match(SQL, /if current_user in \('anon', 'authenticated'\)\s+and new\.delivery_speed is distinct from old\.delivery_speed then/)
  assert.match(SQL, /create trigger orders_protect_delivery_speed\s+before update on public\.orders/)
})

test('the switch: one row everyone can read, only an admin can flip, nothing else writable', () => {
  assert.match(SQL, /id\s+boolean primary key default true check \(id\)/)
  assert.match(SQL, /express_delivery boolean not null default true/)
  assert.match(SQL, /insert into public\.shop_settings \(id\) values \(true\) on conflict \(id\) do nothing;/)
  assert.match(SQL, /alter table public\.shop_settings enable row level security;/)
  assert.match(SQL, /for select to anon, authenticated\s+using \(true\);/)
  assert.match(SQL, /for update to authenticated\s+using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\);/)
  assert.match(SQL, /revoke all on table public\.shop_settings from public, anon, authenticated;/)
  assert.match(SQL, /grant select on table public\.shop_settings to anon, authenticated;/)
  assert.match(SQL, /grant update \(express_delivery\) on table public\.shop_settings to authenticated;/)
  assert.doesNotMatch(SQL, /grant (insert|delete)[^;]*shop_settings/)
})

// ---- the order request ---------------------------------------------------------

test('the delivery choice travels as a request only, and comes back with the order', () => {
  const fn = read('supabase/functions/create-razorpay-order/index.ts')
  assert.match(fn, /delivery_speed: asString\(body\.delivery_speed\),/)
  assert.match(fn, /delivery_speed: order\.delivery_speed,/)
  assert.doesNotMatch(fn, /shipping: (body|asNumber)/, 'the browser never sends a delivery price')
  assert.match(read('src/lib/payments.js'), /\.\.\.\(deliverySpeed \? \{ delivery_speed: deliverySpeed \} : \{\}\),/)
})

test('payment checks and emails see the delivery option, and still work without the column', () => {
  const shared = read('supabase/functions/_shared/supabase.ts')
  assert.match(shared, /subtotal,shipping,discount,coupon_code,total,created_at,delivery_speed`\)\)\n\s+if \(!res\.ok\) res = await serviceFetch\(path\(`\$\{common\}subtotal,shipping,discount,coupon_code,total,created_at`\)\)/)
  assert.match(shared, /is_test,payment_type,new_customer,delivery_speed`\),/)
  for (const f of ['confirmation.ts', 'ownerNotification.ts']) {
    assert.match(read(`supabase/functions/_shared/${f}`), /'&select=\*',/, f)
  }
})

// ---- checkout -------------------------------------------------------------------

const CHECKOUT = read('src/pages/Checkout.jsx')

test('checkout opens on free delivery; Express is chosen only by the shopper', () => {
  assert.match(CHECKOUT, /const \[speed, setSpeed\] = useState\(STANDARD\)/)
  assert.match(CHECKOUT, /type="radio"\s+name="delivery-speed"/)
  assert.match(CHECKOUT, /title="Free delivery"/)
  assert.match(CHECKOUT, /title="Express by air"/)
  // Its price is on the option itself, before anything is added to the total.
  assert.match(CHECKOUT, /price=\{`\+\$\{inr\(shippingFor\(EXPRESS, pieces\)\)\}`\}/)
  assert.match(CHECKOUT, /Arrives by <b className="font-semibold text-black">\{expressBy\}<\/b>/)
  assert.match(CHECKOUT, /expressBy=\{expressArrivalText\(\)\}/)
  // No coverage is ever called out.
  assert.doesNotMatch(CHECKOUT, /PIN code[^.]*Express|Express[^.]*PIN code|not available for/i)
})

test('the total, Pay and the phone Pay bar follow the choice; the server prices it', () => {
  assert.match(CHECKOUT, /const shipping = shippingFor\(speed, pieces\)/)
  assert.match(CHECKOUT, /const total = totalFor\(subtotal, coupon \? discountFor\(coupon, subtotal\) : 0, shipping\)/)
  assert.match(CHECKOUT, /<dd className="font-ui text-\[18px\] font-semibold shrink-0">\{inr\(totalFor\(subtotal, discount, shipping\)\)\}<\/dd>/)
  assert.match(CHECKOUT, /deliverySpeed: speed,/)
  assert.match(CHECKOUT, /\{speed === EXPRESS \? 'Express by air' : 'Free delivery'\}/)
  assert.match(CHECKOUT, /shippingTier: speed,/)
})

test('while Express is paused, checkout shows only free delivery, and falls back to it if refused', () => {
  assert.match(CHECKOUT, /const expressOn = expressOffered && !expressRefused/)
  assert.match(CHECKOUT, /useEffect\(\(\) => \{ if \(!expressOn && speed !== STANDARD\) setSpeed\(STANDARD\) \}, \[expressOn, speed\]\)/)
  assert.match(CHECKOUT, /\{expressOn \? \(/)
  assert.match(CHECKOUT, /if \(\/express delivery is paused\/i\.test\(err\?\.message \|\| ''\)\) \{\n\s+setExpressRefused\(true\)\n\s+setSpeed\(STANDARD\)/)
})

test('the shop pages mention Express only while it is on, priced, without coverage talk', () => {
  for (const f of ['src/pages/Product.jsx', 'src/pages/Cart.jsx']) {
    assert.match(read(f), /<ExpressNote on=\{expressOffered\} className="block mt-\d[^"]*" \/>/, f)
  }
  const note = read('src/components/ExpressNote.jsx')
  assert.match(note, /export default function ExpressNote\(\{ on, className = '' \}\) \{\n\s+if \(!on\) return null/)
  assert.match(note, /Need it sooner\? <b className="font-semibold text-black\/75">Express by air<\/b> in \{EXPRESS_DAYS\} days, \{inr\(EXPRESS_FEE_PER_ITEM\)\} per item, at checkout\./)
  const settings = read('src/lib/shopSettings.js')
  assert.match(settings, /return typeof row\?\.express_delivery === 'boolean' \? row\.express_delivery : true/, 'unreadable counts as on; the database still refuses a paused Express')
  // The scrolling announcement bar is left as it was (the owner's call).
  assert.doesNotMatch(read('src/data/site.js').split('announcements:')[1].split('\n')[0], /express/i)
})

test('the thank-you page and My orders say Express, with the date', () => {
  const thanks = read('src/pages/OrderConfirmation.jsx')
  assert.match(thanks, /if \(order\.delivery_speed !== EXPRESS\) return SHIPPING/)
  assert.match(thanks, /`We send it by air\. It arrives \$\{by \? `by \$\{by\}` : `within \$\{EXPRESS_DAYS\} days`\}\.`/)
  assert.match(thanks, /\{order\.delivery_speed === EXPRESS \? 'Express by air' : 'Shipping'\}/)
  assert.match(thanks, /totalFor\(order\.subtotal, Number\(order\.discount\) \|\| 0, Number\(order\.shipping\) \|\| 0\)/)
  assert.match(read('src/pages/Account.jsx'), /\{o\.delivery_speed === 'express' && ' · Express by air'\}/)
})

// ---- tracking (inside the brief: A8 shipping_tier, A10 shipping) ----------------

test('add_shipping_info names the tier the shopper chose', () => {
  const items = [{ item_id: '0237DA', item_name: 'Set', price: 849, quantity: 1 }]
  const tier = (shippingTier) => shippingEvent({ items, value: 849, shippingTier, eventId: 'e' }).ecommerce.shipping_tier
  assert.equal(tier('express'), 'express')
  assert.equal(tier('standard'), 'standard')
  assert.equal(tier(undefined), 'standard')
  assert.equal(tier('teleport'), 'standard')
})

// ---- emails -------------------------------------------------------------------

const ORDER = {
  reference: '19112601', created_at: '2026-11-19T04:30:00Z', status: 'confirmed',
  payment_method: 'razorpay', payment_status: 'paid', full_name: 'Priya Sharma', email: 'priya@example.com',
  phone: '9876543210', address: 'Flat 12', city: 'Bengaluru', state: 'Karnataka', pincode: '560017',
  subtotal: 849, discount: 0, shipping: 149, total: 998, delivery_speed: 'express',
}
const ITEMS = [{ title: 'Solid Shirt and Pant Combo - Dark Navy Blue', size: 'XL', qty: 1, unit_price: 849, sku: '0237DA' }]

test('the owner\'s email leads with Express, in the subject and the first line', () => {
  assert.equal(isExpress(ORDER), true)
  assert.equal(buildOwnerNotificationSubject(ORDER), 'EXPRESS BY AIR · New order 19112601 — Paid online — ₹998')
  const text = buildOwnerNotificationText(ORDER, ITEMS)
  assert.equal(text.split('\n')[0], 'EXPRESS BY AIR — book air shipping today. The customer was promised delivery by Mon 23 Nov.')
  assert.match(text, /Delivery: EXPRESS BY AIR/)
  assert.match(text, /Shipping: ₹149/)
  const standard = { ...ORDER, delivery_speed: 'standard', shipping: 0, total: 849 }
  assert.equal(buildOwnerNotificationSubject(standard), 'New order 19112601 — Paid online — ₹849')
  assert.equal(buildOwnerNotificationText(standard, ITEMS).split('\n')[0], 'New order — Ruhi Womens Clothing')
})

test('the customer\'s email says Express by air and the date', () => {
  const text = buildConfirmationText(ORDER, ITEMS)
  assert.match(text, /Delivery: Express by air — arrives by Mon 23 Nov/)
  assert.match(text, /Shipping: ₹149/)
  assert.doesNotMatch(buildConfirmationText({ ...ORDER, delivery_speed: 'standard', shipping: 0, total: 849 }, ITEMS), /Express/)
})

// ---- dashboard -------------------------------------------------------------------

test('an Express order is unmissable in the dashboard, and the owner can pause Express', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /const isExpressOrder = \(o\) => o\?\.delivery_speed === EXPRESS/)
  assert.match(panel, /className=\{`\$\{express \? \(done \? 'adm-express adm-express--done ' : 'adm-express '\) : 'bg-white border border-black\/10 '\}rounded-xl overflow-hidden`\}/)
  assert.match(panel, /\{express && <p className="adm-express-note">\{expressNote\}<\/p>\}/)
  assert.match(panel, /\{express && <span className="adm-express-badge">Express · by air<\/span>\}/)
  assert.match(panel, /`Express by air: book air shipping today\.\$\{by \? ` The customer was promised delivery by \$\{by\}\.` : ''\}`/)
  assert.match(panel, /'Express by air: not paid yet\. Send it only once it is paid\.'/)
  assert.match(panel, /done \? `Express by air\$\{by \? ` · promised by \$\{by\}` : ''\}`/)
  assert.match(panel, /<ExpressSwitch notify=\{notify\} \/>/)
  assert.match(panel, /Express \$\{expressWaiting === 1 \? 'order' : 'orders'\} to send by air/)
  assert.match(panel, /return expressOnly \? list\.filter\(isExpressOrder\) : list/)
  const css = read('src/admin/admin.css')
  for (const rule of ['.adm-express {', '.adm-express-badge {', '.adm-express-note {', '.adm-express-alert {', '.adm-express-switch {']) {
    assert.ok(css.includes(rule), rule)
  }
  const sw = read('src/admin/ExpressSwitch.jsx')
  assert.match(sw, /\.from\('shop_settings'\)\.update\(\{ express_delivery: next \}\)\.eq\('id', true\)\.select\('express_delivery'\)/)
  assert.match(sw, /window\.confirm\('Pause Express delivery\?/)
})

test('the Excel export has a Delivery column', () => {
  assert.equal(EXPORT_COLUMNS.at(-1), 'Delivery')
  const rows = ordersToRows([
    { ...ORDER, order_items: ITEMS },
    { ...ORDER, reference: '19112602', delivery_speed: 'standard', order_items: [...ITEMS, ...ITEMS] },
  ])
  const at = (row, name) => row[EXPORT_COLUMNS.indexOf(name)]
  assert.equal(at(rows[0], 'Delivery'), 'Express by air')
  assert.equal(at(rows[1], 'Delivery'), 'Standard')
  assert.equal(at(rows[2], 'Delivery'), '', 'order facts only on an order\'s first row')
  for (const r of rows) assert.equal(r.length, EXPORT_COLUMNS.length)
})

// ---- what the shop says -------------------------------------------------------

test('the policies and FAQ say what Express is, and that its charge is not refunded on a return', () => {
  const policy = read('src/pages/Policy.jsx')
  assert.match(policy, /Express delivery by air is optional and costs ₹149 per item\. You choose it at checkout, where its price is shown before you pay\./)
  assert.match(policy, /Express orders are sent by air and arrive within 4 days of the order, counting every day of the week\./)
  assert.match(policy, /When an Express order is returned, the Express delivery charge \(₹149 per item\) is not refunded\./)
  assert.doesNotMatch(policy, /nothing extra to pay for delivery/)
  assert.match(read('src/data/site.js'), /Need it sooner\? Choose Express by air at checkout: it arrives in 4 days, for ₹149 per item\./)
})

// ---- the A/B test of Express (25 Nov 2026) --------------------------------------

test('express_offer: half the visitors get the shop before Express, decided on paid orders over 8 weeks', async () => {
  const { EXPERIMENTS } = await import('../src/lib/experimentList.js')
  const { assign, shownVariant } = await import('../src/lib/experiments.js')
  const t = EXPERIMENTS.find((x) => x.id === 'express_offer')
  assert.ok(t, 'express_offer is in the list')
  assert.equal(t.status, 'running')
  assert.equal(t.area, 'delivery')
  assert.deepEqual(t.variants, ['a', 'b'])
  assert.deepEqual(t.split, [50, 50])
  assert.deepEqual(t.plan, { metric: 'paid_order', perVersion: 2600, minDays: 56 })
  // About half of 20,000 made-up visitors land in each version.
  let b = 0
  for (let i = 0; i < 20000; i += 1) if (assign(t, `visitor-${i}-${(i * 7919) % 104729}`) === 'b') b += 1
  assert.ok(b > 9700 && b < 10300, `b got ${b} of 20000`)
  // Anyone not counted (staff, bots, a browser that forgets) sees the shop with Express.
  assert.equal(shownVariant(t, { counted: false, visitor: 'x' }), 'a')
  assert.equal(shownVariant({ ...t, status: 'stopped' }, { counted: true, visitor: 'x' }), 'a')
  assert.equal(shownVariant(t, { counted: false, force: { express_offer: 'b' } }), 'b')
})

test('express_offer: version b never offers Express; a visitor counts whether or not Express is paused', () => {
  const hook = read('src/hooks/useExpressOffer.js')
  assert.match(hook, /import \{ EXPRESS_TEST \} from '\.\.\/lib\/expressTest'/)
  assert.match(hook, /const version = useExperiment\(EXPRESS_TEST, \{ active: Boolean\(ready\) \}\)/)
  assert.match(hook, /return on && version !== 'b'/)
  assert.match(read('src/lib/expressTest.js'), /export const EXPRESS_TEST = 'express_offer'/)
  // The pages use the hook for every mention of Express; nothing reads the switch on its own.
  for (const f of ['src/pages/Product.jsx', 'src/pages/Cart.jsx', 'src/pages/Checkout.jsx', 'src/components/ExpressNote.jsx']) {
    assert.doesNotMatch(read(f), /useExpressDelivery|expressDeliveryOn/, f)
  }
})

test('express_offer: version b reads the delivery answer and the policies as they were before Express', async () => {
  const { faqBeforeExpress } = await import('../src/lib/expressTest.js')
  const { policyBeforeExpress } = await import('../src/lib/policyBeforeExpress.js')
  // The FAQ: only the delivery answer changes, back to its words before 19 Nov.
  const faq = [
    ['How long does delivery take?', 'Delivery is free, and most orders arrive in 7-10 working days across India. Need it sooner? Choose Express by air at checkout: it arrives in 4 days, for ₹149 per item.'],
    ['Which payment methods do you accept?', 'Pay securely online at checkout with UPI, cards, net banking or wallets.'],
  ]
  assert.deepEqual(faqBeforeExpress(faq), [
    ['How long does delivery take?', 'Most orders arrive in 7-10 working days across India.'],
    ['Which payment methods do you accept?', 'Pay securely online at checkout with UPI, cards, net banking or wallets.'],
  ])
  // In site.js the delivery answer is the only one that mentions Express.
  const answers = read('src/data/site.js').split('faq: [')[1].split('\n  ],')[0].split('\n').filter((l) => l.trim().startsWith("['"))
  assert.equal(answers.filter((l) => /express/i.test(l)).length, 1)
  assert.match(answers.find((l) => /express/i.test(l)), /^\s*\['How long does delivery take\?'/)
  // A policy: Express lines gone, the old free-shipping line and date back.
  const shipping = { title: 'Shipping policy', updated: '19 November 2026', sections: [
    ['How much shipping costs', ['Standard delivery is free on every order, whatever the order value — there is no minimum spend.', 'Need it sooner? Express delivery by air is optional and costs ₹149 per item.', 'The cart shows it.']],
    ['When your order arrives', ['Working days are Monday to Saturday, excluding public holidays.', 'Express orders are sent by air and arrive within 4 days.']],
  ] }
  assert.deepEqual(policyBeforeExpress('shipping-policy', shipping), { title: 'Shipping policy', updated: undefined, sections: [
    ['How much shipping costs', ['Shipping is free on every order, whatever the order value — there is no minimum spend and nothing extra to pay for delivery.', 'The cart shows it.']],
    ['When your order arrives', ['Working days are Monday to Saturday, excluding public holidays.']],
  ] })
  const refund = { title: 'Return & refund policy', updated: '19 November 2026', sections: [['How refunds are paid', ['Refunds go back.', 'When an Express order is returned, the Express delivery charge (₹149 per item) is not refunded.']]] }
  assert.deepEqual(policyBeforeExpress('refund-policy', refund), { ...refund, updated: '5 November 2026', sections: [['How refunds are paid', ['Refunds go back.']]] })
  const privacy = { title: 'Privacy policy', sections: [] }
  assert.equal(policyBeforeExpress('privacy-policy', privacy), privacy)
  // Where the pages use them.
  assert.match(read('src/pages/Policy.jsx'), /const policy = seesShopBeforeExpress\(\) \? policyBeforeExpress\(slug, POLICIES\[slug\]\) : POLICIES\[slug\]/)
  assert.match(read('src/pages/Contact.jsx'), /\(seesShopBeforeExpress\(\) \? faqBeforeExpress\(site\.faq\) : site\.faq\)\.map\(/)
  // Every Express line in the policies is one policyBeforeExpress takes out (they all say "Express").
  const policyFile = read('src/pages/Policy.jsx')
  assert.equal((policyFile.match(/'[^'\n]*Express[^'\n]*'/g) || []).filter((t) => t.includes(' ')).length, 3)
})

test('express_offer: every change of the Express switch is logged, with the changes before 25 Nov filled in', () => {
  const sql = fs.readFileSync(path.join(DIR, '20261125120000_express_switch_changes.sql'), 'utf8')
  assert.match(sql, /create table if not exists public\.express_switch_changes \(/)
  assert.match(sql, /after update of express_delivery on public\.shop_settings/)
  assert.match(sql, /if new\.express_delivery is distinct from old\.express_delivery then/)
  assert.match(sql, /using \(public\.is_admin\(\)\)/)
  assert.match(sql, /revoke all on table public\.express_switch_changes from anon, authenticated;/)
  for (const row of ["(true,  timestamptz '2026-11-19 16:19:00+05:30')", "(false, timestamptz '2026-11-20 11:46:00+05:30')", "(true,  timestamptz '2026-11-23 09:18:18+05:30')"]) {
    assert.ok(sql.includes(row), row)
  }
  assert.match(sql, /where not exists \(select 1 from public\.express_switch_changes where source = 'backfill'\)/)
})
