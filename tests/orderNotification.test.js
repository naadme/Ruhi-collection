// The order emails: the customer's confirmation and the owner's new-order
// notification.
//
// The bodies are built by `supabase/functions/_shared/orderEmail.mjs`, which
// the Edge Functions and this test both read — so what is proved here is
// exactly what goes out.
//
// Nothing is sent: there is no mail server in this test, no key and no
// recipient. What is proved is the CONTENT, and the rules that decide WHEN a
// mail may be sent at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import {
  buildConfirmationSubject,
  buildConfirmationText,
  buildOwnerNotificationSubject,
  buildOwnerNotificationText,
  isCashOnDelivery,
  isPaid,
  ownerPaymentLabel,
  paymentLabel,
} from '../supabase/functions/_shared/orderEmail.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const MIGRATION = 'supabase/migrations/20261021160000_order_notifications.sql'
const SQL = read(MIGRATION)
const CONFIRM = read('supabase/functions/_shared/confirmation.ts')
const OWNER = read('supabase/functions/_shared/ownerNotification.ts')
const NOTIFY = read('supabase/functions/order-notifications/index.ts')
const RESEND = read('supabase/functions/_shared/resend.ts')
const VERIFY = read('supabase/functions/verify-razorpay-payment/index.ts')
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts')

const online = (over = {}) => ({
  reference: '21102601',
  created_at: '2026-10-20T18:30:00.000Z', // 00:00 IST on 21 October 2026
  full_name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9046651272',
  address: '12 Rose Garden',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  status: 'pending',
  payment_method: 'razorpay',
  payment_status: 'paid',
  razorpay_payment_id: 'pay_ABC123',
  subtotal: 1800,
  discount: 200,
  coupon_code: 'RUHI10',
  shipping: 0,
  total: 1600,
  ...over,
})

const cod = (over = {}) => online({
  payment_method: 'cod',
  payment_status: 'pending',
  razorpay_payment_id: null,
  ...over,
})

const items = [
  { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
  { title: 'Cotton Dress - Green', size: 'L', qty: 1, unit_price: 800, sku: '0302GR' },
]

// ---------------------------------------------------------------------------
// The customer's confirmation
// ---------------------------------------------------------------------------

test('the customer is told how the order will be paid', () => {
  const paid = buildConfirmationText(online(), items)
  assert.match(paid, /Payment: Paid online \(Razorpay\)/)
  assert.match(paid, /Total paid: ₹1,600/)

  const cash = buildConfirmationText(cod(), items)
  assert.match(cash, /Payment: Cash on delivery — pay when it arrives/)
  assert.ok(!/Total paid/.test(cash), 'a cash order has not been paid, so it must not say so')
  assert.match(cash, /Amount to pay on delivery: ₹1,600/)
})

test('a cash order tells the customer what to keep ready', () => {
  const cash = buildConfirmationText(cod(), items)
  assert.match(cash, /keep ₹1,600 ready/)
  assert.match(cash, /pay in cash when the parcel reaches you/)
})

test('an unpaid online order is not described as paid', () => {
  const unpaid = buildConfirmationText(online({ payment_status: 'pending' }), items)
  assert.match(unpaid, /Payment: Online payment — awaiting payment/)
  assert.ok(!/Total paid/.test(unpaid))
  assert.match(unpaid, /Total: ₹1,600/)
})

test('the payment labels name the method, not just the state', () => {
  assert.equal(isCashOnDelivery(cod()), true)
  assert.equal(isCashOnDelivery(online()), false)
  assert.equal(isPaid(online()), true)
  assert.equal(isPaid(cod()), false)
  assert.match(paymentLabel(cod()), /Cash on delivery/)
  assert.match(ownerPaymentLabel(cod()), /not paid yet/)
  assert.match(ownerPaymentLabel(online()), /Paid online/)
})

// ---------------------------------------------------------------------------
// The owner's notification
// ---------------------------------------------------------------------------

test('the owner is told who ordered, where it goes and what is in it', () => {
  const text = buildOwnerNotificationText(online(), items)
  assert.match(text, /New order — Ruhi Womens Clothing/)
  assert.match(text, /Order ID: 21102601/)
  assert.match(text, /Order date: 21 Oct 2026, 00:00 IST/)
  assert.match(text, /Name: Priya Sharma/)
  assert.match(text, /Email: priya@example\.com/)
  assert.match(text, /Phone: 9046651272/)
  assert.match(text, /12 Rose Garden/)
  assert.match(text, /Pune, Maharashtra/)
  assert.match(text, /411001/)
  assert.match(text, /Denim Shirt - Blue \(Size M, Blue, Product ID 0101BU\) × 2 — ₹1,800/)
  assert.match(text, /Cotton Dress - Green \(Size L, Green, Product ID 0302GR\) × 1 — ₹800/)
})

test('the owner is told the payment status, and it is true for each method', () => {
  assert.match(buildOwnerNotificationText(online(), items), /Payment: Paid online \(Razorpay\)/)
  assert.match(buildOwnerNotificationText(online(), items), /Payment ID: pay_ABC123/)
  assert.match(buildOwnerNotificationText(cod(), items), /Payment: Cash on delivery — not paid yet/)
  assert.ok(
    !/Payment ID/.test(buildOwnerNotificationText(cod(), items)),
    'a cash order has no gateway payment id to quote',
  )
})

test('the owner is told the money', () => {
  const text = buildOwnerNotificationText(online(), items)
  assert.match(text, /Subtotal: ₹1,800/)
  assert.match(text, /Discount: −₹200 \(RUHI10\)/)
  assert.match(text, /Shipping: Free/)
  assert.match(text, /Total: ₹1,600/)
})

test('the owner sees the delivery note when there is one', () => {
  assert.match(
    buildOwnerNotificationText(online({ note: 'Ring the bell twice' }), items),
    /Delivery note: Ring the bell twice/,
  )
  assert.ok(
    !/Delivery note/.test(buildOwnerNotificationText(online(), items)),
    'and no empty note line when there is nothing to say',
  )
})

test('the owner notification names the order, the method and the money', () => {
  assert.equal(
    buildOwnerNotificationSubject(online()),
    'New order 21102601 — Paid online — ₹1,600',
  )
  assert.equal(
    buildOwnerNotificationSubject(cod()),
    'New order 21102601 — Cash on delivery — ₹1,600',
  )
})

test('the owner notification is never empty, even without items', () => {
  const text = buildOwnerNotificationText(online(), [])
  assert.match(text, /Order ID: 21102601/)
  assert.match(text, /Items \(0 lines\)/)
  assert.match(text, /Total: ₹1,600/)
  assert.ok(!/undefined/.test(text))
  assert.ok(!/null/.test(text))
})

// ---------------------------------------------------------------------------
// Sending it — once, and only once
// ---------------------------------------------------------------------------

test('the owner notification is claimed with a compare-and-set', () => {
  assert.match(OWNER, /owner_notified_at=is\.null/)
  assert.match(OWNER, /method:\s*'PATCH'/)
  assert.match(OWNER, /or=\(payment_status\.eq\.paid,payment_method\.eq\.cod\)/)
  assert.match(OWNER, /await release\(orderId\)/, 'a failed send gives the slot back')
})

test('the owner notification and the customer confirmation use separate slots', () => {
  // Two recipients, two markers: a customer whose mail failed must not stop
  // the owner from being told, and the owner being told must not stop the
  // customer from hearing about their order.
  assert.match(OWNER, /owner_notified_at/)
  assert.ok(!/confirmation_sent_at/.test(OWNER), 'the owner uses its own column')
  assert.match(CONFIRM, /confirmation_sent_at/)
  assert.ok(!/owner_notified_at/.test(CONFIRM), 'and the customer uses its own')
})

test('the owner always writes to the same inbox, whatever the caller says', () => {
  assert.match(OWNER, /ruhicollections2026@gmail\.com/)
  // There is no "to" parameter anywhere in the module.
  assert.match(OWNER, /export async function sendOwnerNotification\(orderId: string\)/)
  assert.ok(
    !/function sendOwnerNotification\([^)]*(to|email|recipient)[^)]*\)/i.test(OWNER),
    'the recipient is not a parameter',
  )
})

test('both payment paths tell the owner', () => {
  for (const [name, src] of [['verify', VERIFY], ['webhook', WEBHOOK]]) {
    assert.match(src, /import \{ sendOwnerNotification \}/, `${name} imports it`)
    const at = src.indexOf('sendOwnerNotification(')
    assert.ok(at > -1, `${name} calls it`)
    assert.match(src.slice(Math.max(0, at - 200), at + 200), /catch/, `${name} swallows a mail error`)
  }
})

test('a mail failure never fails the payment response', () => {
  const at = VERIFY.indexOf('sendOwnerNotification(')
  assert.ok(VERIFY.indexOf('try {', VERIFY.lastIndexOf('try {', at)) < at)
})

// ---------------------------------------------------------------------------
// The endpoint the database calls
// ---------------------------------------------------------------------------

test('the notification endpoint cannot be used as a mail relay', () => {
  assert.match(NOTIFY, /ORDER_NOTIFICATIONS_SECRET/)
  assert.match(NOTIFY, /secretMatches/, 'the caller must present the secret')
  assert.match(NOTIFY, /fail\(401/, 'and is refused without it')
  // The recipient of the owner's mail is decided in the module, not in the
  // request body.
  assert.ok(!/body\.to\b/.test(NOTIFY), 'the request cannot name a recipient')
  assert.ok(!/body\.email\b/.test(NOTIFY), 'nor an address to write to')
})

test('the notification endpoint is registered with JWT verification off', () => {
  // The database calls it through `pg_net`, with no JWT at all — it proves
  // itself with the shared secret instead.
  const config = read('supabase/config.toml')
  assert.match(config, /\[functions\.order-notifications\]\s*\nverify_jwt = false/)
})

test('the notification endpoint refuses to run without its secret', () => {
  assert.match(NOTIFY, /requireEnv\('ORDER_NOTIFICATIONS_SECRET'\)/)
  assert.match(NOTIFY, /fail\(503/)
})

// ---------------------------------------------------------------------------
// The database side
// ---------------------------------------------------------------------------

test('the migration adds the owner marker without touching any order', () => {
  assert.match(SQL, /alter table public\.orders/i)
  assert.match(SQL, /add column if not exists owner_notified_at timestamptz/i)
  assert.doesNotMatch(SQL, /owner_notified_at timestamptz not null/i)
  assert.ok(!/^\s*update\s+public\.orders\b/im.test(SQL), 'it must not rewrite any order row')
  assert.ok(!/delete\s+from/i.test(SQL), 'and it deletes nothing')
})

test('a browser can no longer stamp an order as already-notified', () => {
  assert.match(SQL, /current_user in \('anon', 'authenticated'\)/i)
  assert.match(SQL, /new\.owner_notified_at\s+is distinct from old\.owner_notified_at/i)
})

test('the trigger is deferred, so the order has its lines before it is announced', () => {
  // `create_order()` inserts the order row first and its items afterwards, so
  // a trigger that fired on the insert would announce an order with no
  // products in it.
  assert.match(SQL, /create constraint trigger orders_announce/i)
  assert.match(SQL, /deferrable initially deferred/i)
  assert.match(SQL, /after insert or update on public\.orders/i)
})

test('only a real order is announced', () => {
  const trigger = SQL.slice(SQL.indexOf('create or replace function public.announce_order_to_store'))
  // A cash-on-delivery order, the moment it is placed…
  assert.match(trigger, /new\.payment_method is distinct from 'cod' then\s*\n\s*return null;/)
  // …and an online order only once the gateway has settled it.
  assert.match(trigger, /new\.payment_status is distinct from 'paid' then\s*\n\s*return null;/)
  assert.match(trigger, /new\.payment_status is not distinct from old\.payment_status then/)
})

test('a failed announcement never costs the shop an order', () => {
  const trigger = SQL.slice(SQL.indexOf('create or replace function public.announce_order_to_store'))
  assert.match(trigger, /exception when others then/, 'the whole announcement is wrapped')
  assert.match(trigger, /raise warning 'could not queue the order notification/)
  // And the trigger never writes to the order it is announcing.
  assert.ok(!/update\s+public\.orders/i.test(trigger))
  assert.ok(!/insert\s+into\s+public\.orders/i.test(trigger))
})

test('the trigger keeps its secret in the vault, not in the repository', () => {
  assert.match(SQL, /vault\.decrypted_secrets/)
  assert.match(SQL, /order_notifications_url/)
  assert.match(SQL, /order_notifications_secret/)
  // The migration must not carry a secret value.
  assert.ok(!/order_notifications_secret',\s*'[a-f0-9]{16,}'/i.test(SQL))
})

test('the migration is reversible and transaction-wrapped', () => {
  assert.match(SQL, /To revert/i)
  assert.match(SQL, /drop column if exists owner_notified_at/i)
  assert.equal((SQL.match(/^\s*begin;\s*$/gim) || []).length, 1)
  assert.equal((SQL.match(/^\s*commit;\s*$/gim) || []).length, 1)
})

// ---------------------------------------------------------------------------
// Nothing secret reaches the browser
// ---------------------------------------------------------------------------

test('no mail or notification secret is in the browser bundle', () => {
  const files = [
    'src/lib/razorpay.js', 'src/lib/payments.js', 'src/lib/checkout.js',
    'src/pages/Checkout.jsx', 'src/admin/OrdersPanel.jsx',
  ]
  for (const file of files) {
    const src = read(file)
    assert.ok(!/RESEND/i.test(src), `${file} knows nothing about the mail key`)
    assert.ok(!/ORDER_NOTIFICATIONS_SECRET/i.test(src), `${file} knows nothing about the notify secret`)
  }
  const env = read('.env.example')
  assert.ok(!/VITE_RESEND/.test(env), 'the mail key is never a VITE_ variable')
  assert.ok(!/VITE_ORDER_NOTIFICATIONS/.test(env), 'nor is the notification secret')
})

test('the mail key is read in exactly one place, on the server', () => {
  assert.match(RESEND, /requireEnv\('RESEND_API_KEY'\)/)
  // Every other module goes through that one module.
  assert.match(CONFIRM, /from '\.\/resend\.ts'/)
  assert.match(OWNER, /from '\.\/resend\.ts'/)
  const contact = read('supabase/functions/send-contact-email/index.ts')
  assert.match(contact, /from '\.\.\/_shared\/resend\.ts'/)
})

test('there is no module that can be pointed at an address of the caller\'s choosing', () => {
  // The one function that takes a recipient from the caller is the contact
  // form, and even there the recipient is a constant and the address is only
  // the reply-to.
  const contact = read('supabase/functions/send-contact-email/index.ts')
  assert.match(contact, /const TO = 'ruhicollections2026@gmail\.com'/)
  assert.ok(!existsSync(path.join(process.cwd(), 'supabase/functions/send-order-email')))
})
