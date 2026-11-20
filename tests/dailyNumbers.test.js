// "Daily numbers" (20 Nov 2026): the owner's dashboard. These tests pin
//   * the sums (src/admin/daily/dailyMetrics.js),
//   * the sync's readers and row shapes (supabase/functions/_shared/dashboardSync.mjs),
//     with fake Meta / GA4 / Razorpay answers, and
//   * the rules that keep it owner-only, personal-data-free and off the shop's
//     download path.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { generateKeyPairSync, createVerify } from 'node:crypto'

import * as M from '../src/admin/daily/dailyMetrics.js'
import * as S from '../supabase/functions/_shared/dashboardSync.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
test('date choices: last 7 / 30 days end yesterday, the comparison is the same length just before', () => {
  const today = '2026-11-20'
  assert.deepEqual(M.presetRange('today', today), { from: today, to: today })
  assert.deepEqual(M.presetRange('yesterday', today), { from: '2026-11-19', to: '2026-11-19' })
  assert.deepEqual(M.presetRange('last7', today), { from: '2026-11-13', to: '2026-11-19' })
  assert.deepEqual(M.presetRange('last30', today), { from: '2026-10-21', to: '2026-11-19' })
  assert.deepEqual(M.presetRange('month', today), { from: '2026-11-01', to: today })
  assert.deepEqual(M.presetRange('custom', today, { from: '2026-11-25', to: '2026-11-30' }), { from: today, to: today }, 'never past today')
  assert.deepEqual(M.previousRange({ from: '2026-11-13', to: '2026-11-19' }), { from: '2026-11-06', to: '2026-11-12' })
  assert.equal(M.istDayOf('2026-11-19T19:00:00Z'), '2026-11-20', '00:30 IST is the next India day')
  assert.equal(M.weekOf('2026-11-20'), '2026-11-16', 'weeks start on Monday')
  assert.equal(S.istMidnight('2026-11-20'), Date.parse('2026-11-19T18:30:00Z') / 1000)
})

test('the sync re-reads the last 7 days, or everything since 1 Oct on its first run', () => {
  assert.deepEqual(S.syncRange({ today: '2026-11-20' }), { from: '2026-11-13', to: '2026-11-20' })
  assert.deepEqual(S.syncRange({ today: '2026-11-20', firstRun: true }), { from: S.BACKFILL_FROM, to: '2026-11-20' })
  assert.deepEqual(S.syncRange({ today: '2026-11-20', from: '2026-11-01' }), { from: '2026-11-01', to: '2026-11-20' })
  assert.deepEqual(S.syncRange({ today: '2026-11-20', from: '2020-01-01' }), { from: '2026-11-13', to: '2026-11-20' }, 'nothing before the backfill start')
  assert.deepEqual(S.syncRange({ today: '2026-11-20', from: "1'; drop" }), { from: '2026-11-13', to: '2026-11-20' })
})

// ---------------------------------------------------------------------------
// Costs and filters
// ---------------------------------------------------------------------------
test('a typed-in cost is spread evenly over its days', () => {
  const costs = [
    { kind: 'marketing', amount: 3000, starts_on: '2026-11-01', ends_on: '2026-11-30' },
    { kind: 'other', amount: 500, starts_on: '2026-11-15', ends_on: '2026-11-15' },
  ]
  assert.equal(M.costsIn(costs, { from: '2026-11-13', to: '2026-11-19' }, 'marketing'), 700)
  assert.equal(M.costsIn(costs, { from: '2026-11-13', to: '2026-11-19' }, 'other'), 500)
  assert.equal(M.costsIn(costs, { from: '2026-12-01', to: '2026-12-07' }, 'marketing'), 0)
  assert.equal(M.costsByDay(costs, '2026-11-02', 'marketing'), 100)
})

test('a number that a filter cannot follow is not shown, and says why', () => {
  const f = { ...M.EMPTY_FILTERS, device: 'android' }
  assert.deepEqual(M.unsupported('meta', f), ['device'])
  assert.deepEqual(M.unsupported('orders', f), ['device'])
  assert.deepEqual(M.unsupported('ga4', f), [])
  assert.equal(M.cantSplit(['device', 'state']), "Can't be split by device, state")
  // Orders know only "from a Meta / Google ad" or not.
  assert.deepEqual(M.unsupported('orders', { ...M.EMPTY_FILTERS, channel: 'meta_ads' }), [])
  assert.deepEqual(M.unsupported('orders', { ...M.EMPTY_FILTERS, channel: 'social' }), ['channel'])
  assert.deepEqual(M.unsupported('meta', { ...M.EMPTY_FILTERS, ad: 'Ad3' }), [])
  assert.equal(M.ga4Mode({ ...M.EMPTY_FILTERS, ab: 'aa_check:b' }), 'ab')
  assert.equal(M.ga4Mode({ ...M.EMPTY_FILTERS, product: 'Maxi dress' }), 'items')
})

test('campaign, ad set and ad choices become the ad names every source can match', () => {
  const ads = [
    { ad_id: '1', ad_name: 'Ad1', adset_name: 'S1', campaign_name: 'C1' },
    { ad_id: '3', ad_name: 'Ad3', adset_name: 'S1', campaign_name: 'C1' },
    { ad_id: '9', ad_name: 'Ad9', adset_name: 'S2', campaign_name: 'C2' },
  ]
  assert.equal(M.adNamesFor(M.EMPTY_FILTERS, ads), null)
  assert.deepEqual([...M.adNamesFor({ ...M.EMPTY_FILTERS, campaign: 'C1' }, ads)].sort(), ['Ad1', 'Ad3'])
  assert.deepEqual([...M.adNamesFor({ ...M.EMPTY_FILTERS, adset: 'S2' }, ads)], ['Ad9'])
  assert.deepEqual([...M.adNamesFor({ ...M.EMPTY_FILTERS, ad: 'Ad3' }, ads)], ['Ad3'])
  assert.equal(M.designOf('Maxi dress - Checks - Black & White'), 'Maxi dress')
})

// ---------------------------------------------------------------------------
// One period, end to end
// ---------------------------------------------------------------------------
const RANGE = { from: '2026-11-18', to: '2026-11-19' }
const META_ADS = [{ ad_id: 'a3', ad_name: 'Ad3', adset_name: 'S1', campaign_name: 'C1' }]
const order = (o) => ({
  total: 849, payment_status: 'pending', razorpay_order_id: null, utm_source: null, fbc: null,
  new_customer: true, state: 'Karnataka', experiments: null, payment_type: null,
  order_items: [{ title: 'Solid Shirt and Pant Combo - Dark Navy Blue', qty: 1, unit_price: 849 }], ...o,
})
const DATA = {
  metaDaily: [
    { day: '2026-11-18', ad_id: 'a3', ad_name: 'Ad3', adset_name: 'S1', campaign_name: 'C1', spend: 300, impressions: 3000, link_clicks: 60, video_3s: 600, video_p25: 150, add_to_cart: 5, purchases: 1 },
    { day: '2026-11-19', ad_id: 'a3', ad_name: 'Ad3', adset_name: 'S1', campaign_name: 'C1', spend: 200, impressions: 2000, link_clicks: 40, video_3s: 400, video_p25: 100, add_to_cart: 3, purchases: 1 },
  ],
  ga4: [
    ...['2026-11-18', '2026-11-19'].flatMap((day) => [
      { part: 'day', day, event_name: 'session_start', users: 50 },
      { part: 'day', day, event_name: 'view_item', users: 40 },
      { part: 'day', day, event_name: 'add_to_cart', users: 6 },
      { part: 'day', day, event_name: 'begin_checkout', users: 4 },
    ]),
    { part: 'ad', key: 'Ad3', event_name: 'session_start', users: 80 },
    { part: 'channel', key: 'meta_ads', event_name: 'session_start', users: 80 },
    { part: 'channel', key: 'direct', event_name: 'session_start', users: 20 },
  ],
  orders: [
    order({ created_at: '2026-11-18T05:00:00Z', reference: 'A', payment_status: 'paid', razorpay_order_id: 'order_A', utm_source: 'Meta_Ads', utm_content: 'Ad3', payment_type: 'upi' }),
    order({ created_at: '2026-11-19T05:00:00Z', reference: 'B', payment_status: 'paid', razorpay_order_id: 'order_B', total: 1698, payment_type: 'card',
      order_items: [{ title: 'Maxi dress - Brown', qty: 2, unit_price: 849 }] }),
    order({ created_at: '2026-11-19T06:00:00Z', reference: 'C', razorpay_order_id: 'order_C' }),
    order({ created_at: '2026-11-19T07:00:00Z', reference: 'D' }),
    order({ created_at: '2026-11-25T07:00:00Z', reference: 'LATER', payment_status: 'paid' }),
  ],
  leads: [{ last_seen_at: '2026-11-19T06:00:00Z', utm_content: 'Ad3', has_meta_click: true }],
  attempts: [
    { id: 'p1', rzp_order_id: 'order_A', day: '2026-11-18', status: 'captured', captured: true, method: 'upi', amount: 849, fee: 20, tax: 3, settlement_id: 'setl_1' },
    { id: 'p2', rzp_order_id: 'order_B', day: '2026-11-19', status: 'captured', captured: true, method: 'card', amount: 1698, fee: 40, tax: 6 },
    { id: 'p3', rzp_order_id: 'order_C', day: '2026-11-19', status: 'failed', captured: false, method: 'upi', amount: 849, error_description: 'Payment was cancelled by the user', error_step: 'payment_authentication' },
    { id: 'p4', rzp_order_id: 'order_C', day: '2026-11-19', status: 'failed', captured: false, method: 'upi', amount: 849, error_description: 'Payment was cancelled by the user' },
  ],
  expenses: [{ kind: 'marketing', amount: 100, starts_on: '2026-11-18', ends_on: '2026-11-19' }, { kind: 'other', amount: 50, starts_on: '2026-11-19', ends_on: '2026-11-19' }],
}

test('the top numbers: spend without GST plus typed-in marketing, revenue from paid orders only', () => {
  const t = M.periodTotals({ data: DATA, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(t.metaSpend, 500)
  assert.equal(t.adSpend, 600, 'Meta ₹500 + typed-in marketing ₹100')
  assert.equal(t.revenue, 849 + 1698, 'the later order and the unpaid ones are not revenue')
  assert.equal(t.paidOrders, 2)
  assert.equal(t.pieces, 3)
  assert.equal(t.roas, (849 + 1698) / 600)
  assert.equal(t.adRevenue, 849, 'only order A came from a Meta ad')
  assert.equal(t.adRoas, 849 / 500, 'ad orders ÷ Meta spend')
  assert.equal(t.costPerOrder, 300)
  assert.equal(Math.round(t.profit * 100) / 100, Math.round(((849 + 1698) * 0.3 - 600 - 50) * 100) / 100)
  assert.equal(Math.round(t.breakEvenRoas * 100) / 100, 3.33)
  assert.equal(t.unpaidOrders, 1, 'C opened the payment window and did not pay; D never reached it')
})

test('the funnel runs from the ad to the bank', () => {
  const t = M.periodTotals({ data: DATA, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.deepEqual(
    Object.fromEntries(M.STEPS.map((s) => [s.key, t.step[s.key]])),
    {
      impressions: 5000, clicks: 100, session_start: 100, view_item: 80, select_size: 0, add_to_cart: 12,
      begin_checkout: 8, leads: 1, add_shipping_info: 0, pay_window: 3, tried: 3, paid: 2, settled: 1,
    },
  )
  // With the transfer list, only a processed transfer counts as in the bank.
  const unprocessed = M.periodTotals({ data: { ...DATA, settlements: [{ id: 'setl_1', status: 'created' }] }, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(unprocessed.step.settled, 0)
  const processedT = M.periodTotals({ data: { ...DATA, settlements: [{ id: 'setl_1', status: 'processed' }] }, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(processedT.step.settled, 1)
  const rows = M.funnelRows(t, null)
  assert.equal(rows.find((r) => r.key === 'clicks').ofPrevious, 100 / 5000)
  assert.equal(rows.find((r) => r.key === 'add_to_cart').costEach, 600 / 12)
  assert.equal(rows.find((r) => r.key === 'impressions').costEach, null)
  // Visitors include people who never saw an ad: not measured against ad clicks…
  assert.equal(rows.find((r) => r.key === 'session_start').ofPrevious, null)
  assert.equal(rows.find((r) => r.key === 'session_start').hint, 'All visitors, not only from ads')
  // …unless the channel is Meta ads.
  const metaOnly = M.periodTotals({ data: DATA, filters: { ...M.EMPTY_FILTERS, channel: 'meta_ads' }, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(M.funnelRows(metaOnly, null).find((r) => r.key === 'session_start').ofPrevious, 100 / 100)
  const oneAd = M.periodTotals({ data: DATA, filters: { ...M.EMPTY_FILTERS, ad: 'Ad3' }, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(M.funnelRows(oneAd, null).find((r) => r.key === 'session_start').hint, '', 'one ad\'s visitors all came from it')
  // Phone numbers are a side step: the address step is measured against checkouts.
  assert.equal(rows.find((r) => r.key === 'leads').ofPrevious, 1 / 8)
  assert.equal(rows.find((r) => r.key === 'add_shipping_info').ofPrevious, 0 / 8)
  const before = { ...t, step: { ...t.step, paid: 2, settled: 2 } }
  assert.notEqual(M.biggestDrop(t, before)?.key, 'settled', 'waiting for a settlement is not a drop')
  assert.equal(M.fmtInr(-1234.4), '−₹1,234')
  assert.equal(M.fmtInr(84900), '₹84,900')
})

test('with a device filter, Meta and order numbers step aside instead of showing wrong figures', () => {
  const f = { ...M.EMPTY_FILTERS, device: 'android' }
  const t = M.periodTotals({ data: DATA, filters: f, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(t.adSpend, null)
  assert.equal(t.revenue, null)
  assert.equal(t.roas, null)
  assert.equal(t.step.impressions, null)
  assert.equal(t.na.impressions, "Can't be split by device")
  assert.equal(t.step.session_start, 100, 'GA4 can follow it (the database already filtered these rows)')
})

test('with an ad filter: Meta for that ad, orders and phone numbers matched by the ad name, no typed-in costs', () => {
  const f = { ...M.EMPTY_FILTERS, ad: 'Ad3' }
  const t = M.periodTotals({ data: DATA, filters: f, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(t.adSpend, 500, 'typed-in costs belong to no single ad')
  assert.equal(t.paidOrders, 1)
  assert.equal(t.revenue, 849)
  assert.equal(t.step.leads, 1)
})

test('with a product filter, revenue is that product\'s lines only', () => {
  const f = { ...M.EMPTY_FILTERS, product: 'Maxi dress' }
  const t = M.periodTotals({ data: { ...DATA, ga4Items: [{ day: '2026-11-19', viewed: 30, added: 4, checked_out: 2, purchased: 2 }] }, filters: f, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(t.revenue, 1698)
  assert.equal(t.paidOrders, 1)
  assert.equal(t.step.view_item, 30)
  assert.equal(t.step.session_start, null)
  assert.equal(t.adSpend, null, 'Meta cannot split spend by product')
})

test('with an A/B version, GA4 steps come from the A/B table; visitors are not counted', () => {
  const f = { ...M.EMPTY_FILTERS, ab: 'aa_check:b' }
  const data = { ...DATA, ga4Ab: [{ day: '2026-11-19', event_name: 'session_start', users: 3 }, { day: '2026-11-19', event_name: 'view_item', users: 30 }],
    orders: DATA.orders.map((o) => (o.reference === 'A' ? { ...o, experiments: { aa_check: 'b' } } : o)) }
  const t = M.periodTotals({ data, filters: f, range: RANGE, metaAds: META_ADS, margin: 30 })
  assert.equal(t.step.session_start, null)
  assert.match(t.na.session_start, /A\/B version/)
  assert.equal(t.step.view_item, 30)
  assert.equal(t.paidOrders, 1)
  assert.equal(t.adSpend, null)
})

test('day rows, ad rows, payments, money and checks', () => {
  const days = M.dailyRows({ data: DATA, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS })
  assert.deepEqual(days.map((d) => [d.key, d.spend, d.visitors, d.paid, d.revenue]), [
    ['2026-11-18', 350, 50, 1, 849],
    ['2026-11-19', 250, 50, 1, 1698],
  ])
  const ads = M.adRows({ data: DATA, filters: M.EMPTY_FILTERS, range: RANGE, metaAds: META_ADS })
  assert.equal(ads.length, 1)
  assert.equal(ads[0].spend, 500)
  assert.equal(ads[0].hookRate, 1000 / 5000)
  assert.equal(ads[0].visitors, 80)
  assert.equal(ads[0].paid, 1)
  assert.equal(ads[0].roas, 849 / 500)

  const pay = M.paymentSummary(DATA.attempts)
  assert.equal(pay.ordersTried, 3)
  assert.equal(pay.ordersPaid, 2)
  assert.equal(pay.failed, 2)
  assert.deepEqual(pay.reasons.map((r) => [r.reason, r.n]), [['Payment was cancelled by the user', 2]])
  assert.deepEqual(pay.byMethod.map((m) => [m.method, m.attempts, m.ok]), [['upi', 3, 1], ['card', 1, 1]])

  // Money in follows the payments made on the chosen days, so the tiles add up:
  // collected = in the bank + waiting + fees + refunded (the owner's question, 20 Nov).
  const attempts = DATA.attempts.map((a) => (a.id === 'p2' ? { ...a, amount_refunded: 100 } : a))
  const older = { id: 'p0', rzp_order_id: 'order_Z', day: '2026-11-10', status: 'captured', captured: true, amount: 999, fee: 0, tax: 0 }
  const money = M.moneySummary({
    attempts: [...attempts, older],
    settlements: [
      { id: 'setl_1', day: '2026-11-19', amount: 829, status: 'processed', created_at: '2026-11-19T10:00:00Z' },
      { id: 'old', day: '2026-11-12', amount: 999, status: 'processed', created_at: '2026-11-12T10:00:00Z' },
    ],
    allCaptured: [...attempts.filter((a) => a.captured), { ...older, settlement_id: null }],
    range: RANGE,
  })
  assert.equal(money.payments, 2)
  assert.equal(money.collected, 2547, 'payments made on these days only')
  assert.equal(money.inBank, 849 - 20, 'A is in a settlement')
  assert.equal(money.waiting, 1698 - 40 - 100, 'B is not settled yet (after its fee and refund)')
  assert.equal(money.fees, 60)
  assert.equal(money.refunds, 100)
  assert.equal(money.collected, money.inBank + money.waiting + money.fees + money.refunds, 'the tiles add up')
  assert.equal(money.transferred, 829, 'transfers made on these days, listed separately')
  assert.deepEqual(money.transfers.map((s) => s.id), ['setl_1'])
  assert.equal(money.waitingNow, 1558 + 999, 'right now, whatever the dates: B and the older payment')
  assert.equal(money.waitingNowCount, 2)
  // A transfer Razorpay has only 'created' (no bank reference yet) hasn't arrived.
  const pendingTransfer = M.moneySummary({
    attempts, allCaptured: attempts.filter((a) => a.captured), range: RANGE,
    settlements: [{ id: 'setl_1', day: '2026-11-19', amount: 829, status: 'created', created_at: '2026-11-19T10:00:00Z' }],
  })
  assert.equal(pendingTransfer.inBank, 0)
  assert.equal(pendingTransfer.waiting, 829 + 1558)

  const list = M.checks({
    orders: [...DATA.orders, order({ created_at: '2026-11-19T08:00:00Z', reference: 'STUCK', razorpay_order_id: 'order_S' })],
    ga4Purchases: 1,
    metaPurchases: 2,
    allAttempts: [...DATA.attempts, { rzp_order_id: 'order_S', captured: true }],
    metaAccount: { spend_cap: 600, amount_spent: 500 },
    metaSpendLast7: 3500,
    runs: [{ finished_at: new Date(Date.now() - 20 * 60000).toISOString(), sources: { meta: { ok: true }, ga4: { ok: false, error: 'GA4 403' }, razorpay: { ok: true } } }],
    range: RANGE,
  })
  const by = Object.fromEntries(list.map((c) => [c.key, c]))
  assert.equal(by.tracking.bad, true, 'GA4 saw fewer sales than were paid')
  assert.equal(by.stuck.bad, true)
  assert.match(by.stuck.text, /STUCK/)
  assert.equal(by.balance.bad, true, '₹100 left at ₹500 a day')
  assert.equal(by['fresh-meta'].bad, false)
  assert.equal(by['fresh-ga4'].bad, true)
  assert.match(by['fresh-ga4'].text, /GA4 403/)
})

// ---------------------------------------------------------------------------
// The sync's readers
// ---------------------------------------------------------------------------
test('visits are sorted into channels; tests are kept apart', () => {
  assert.equal(S.channelOf('Meta_Ads / paid_social'), 'meta_ads')
  assert.equal(S.channelOf('google / cpc'), 'google_ads')
  assert.equal(S.channelOf('ig / social'), 'social')
  assert.equal(S.channelOf('m.facebook.com / referral'), 'social')
  assert.equal(S.channelOf('l.instagram.com / referral'), 'social')
  assert.equal(S.channelOf('google / organic'), 'search')
  assert.equal(S.channelOf('(direct) / (none)'), 'direct')
  assert.equal(S.channelOf('tagassistant.google.com / referral'), 'test')
  assert.equal(S.channelOf('adsmanager.facebook.com / referral'), 'test')
  assert.equal(S.channelOf('chatgpt.com / ai-assistant'), 'other')
  assert.equal(S.deviceOf('mobile', 'Android'), 'android')
  assert.equal(S.deviceOf('mobile', 'iOS'), 'iphone')
  assert.equal(S.deviceOf('desktop', 'Macintosh'), 'computer')
  assert.equal(S.browserOf('Android Webview'), 'in_app')
  assert.equal(S.browserOf('Safari (in-app)'), 'in_app')
  assert.equal(S.browserOf('Samsung Internet'), 'other')
})

test('Meta rows: pixel events first, 3-second plays, no GST added', () => {
  const row = S.metaAdRow({
    date_start: '2026-11-19', ad_id: '1', ad_name: 'Ad3', adset_id: '2', adset_name: 'S', campaign_id: '3', campaign_name: 'C',
    spend: '260.11', impressions: '1555', reach: '1300', inline_link_clicks: '55',
    actions: [
      { action_type: 'link_click', value: '55' }, { action_type: 'add_to_cart', value: '15' },
      { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '14' }, { action_type: 'omni_purchase', value: '4' },
      { action_type: 'landing_page_view', value: '50' }, { action_type: 'video_view', value: '426' },
    ],
    action_values: [{ action_type: 'omni_purchase', value: '3396' }],
    video_p25_watched_actions: [{ action_type: 'video_view', value: '161' }],
  })
  assert.equal(row.spend, 260.11)
  assert.equal(row.add_to_cart, 14, 'the pixel event wins')
  assert.equal(row.purchases, 4)
  assert.equal(row.purchase_value, 3396)
  assert.equal(row.video_3s, 426)
  assert.equal(row.video_p25, 161)
  assert.equal(row.landing_page_views, 50)
})

test('Meta: every page is read, and a token never reaches an error message', async () => {
  const calls = []
  const fake = async (url) => {
    calls.push(String(url))
    const u = new URL(url)
    if (u.pathname.endsWith('/act_1098399405121569')) return new Response(JSON.stringify({ currency: 'INR', spend_cap: '466100', amount_spent: '455717', balance: '0' }))
    if (u.searchParams.get('breakdowns')) return new Response(JSON.stringify({ data: [{ date_start: '2026-11-19', age: '35-44', publisher_platform: 'instagram', platform_position: 'instagram_reels', spend: '10' }] }))
    if (u.searchParams.get('page') === '2') return new Response(JSON.stringify({ data: [{ date_start: '2026-11-19', ad_id: '2', ad_name: 'B', spend: '5' }] }))
    return new Response(JSON.stringify({ data: [{ date_start: '2026-11-19', ad_id: '1', ad_name: 'A', spend: '7' }], paging: { next: `${url}&page=2` } }))
  }
  const out = await S.readMeta({ fetchImpl: fake, token: 'EAAsecret', from: '2026-11-13', to: '2026-11-20' })
  assert.deepEqual(out.daily.map((r) => r.ad_name), ['A', 'B'])
  assert.equal(out.account.spend_cap, 4661)
  assert.equal(out.account.amount_spent, 4557.17)
  assert.ok(calls.every((c) => !c.includes('EAAsecret')), 'the token goes in a header, never in a URL')

  const failing = async () => new Response(JSON.stringify({ error: { message: 'Malformed access token EAAabc123' } }), { status: 400 })
  await assert.rejects(S.readMeta({ fetchImpl: failing, token: 'EAAabc123', from: '2026-11-13', to: '2026-11-20' }), (e) => {
    assert.doesNotMatch(e.message, /EAAabc123/)
    return true
  })
})

test('GA4: signs in with the service account (RS256) and sums rows that land on the same split', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = { client_email: 'reader@x.iam.gserviceaccount.com', private_key_id: 'k1', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
  const secret = Buffer.from(JSON.stringify(key)).toString('base64')
  const bodies = []
  const fake = async (url, init) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(init.body).get('assertion')
      const [h, c, sig] = assertion.split('.')
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))
      assert.ok(ok, 'the JWT signature verifies with the public key')
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/analytics.readonly')
      return new Response(JSON.stringify({ access_token: 'ya29.token' }))
    }
    const body = JSON.parse(init.body)
    bodies.push(body)
    const names = body.dimensions.map((d) => d.name)
    if (names.includes('itemName')) return new Response(JSON.stringify({ rowCount: 0, rows: [] }))
    if (names.includes('customEvent:ab_tests')) {
      return new Response(JSON.stringify({
        dimensionHeaders: names.map((name) => ({ name })), metricHeaders: [{ name: 'totalUsers' }, { name: 'eventCount' }], rowCount: 2,
        rows: [
          { dimensionValues: [{ value: '20261119' }, { value: 'add_to_cart' }, { value: 'aa_check:b' }], metricValues: [{ value: '3' }, { value: '4' }] },
          { dimensionValues: [{ value: '20261119' }, { value: 'add_to_cart' }, { value: '(not set)' }], metricValues: [{ value: '9' }, { value: '9' }] },
        ],
      }))
    }
    const row = (browser, users) => ({
      dimensionValues: ['20261119', 'session_start', 'Meta_Ads / paid_social', 'Ad3', 'mobile', 'Android', browser, 'new', 'India'].map((value) => ({ value })),
      metricValues: [{ value: String(users) }, { value: String(users) }],
    })
    return new Response(JSON.stringify({
      dimensionHeaders: names.map((name) => ({ name })), metricHeaders: [{ name: 'totalUsers' }, { name: 'eventCount' }], rowCount: 2,
      rows: [row('Chrome', 5), row('Chrome', 2)],
    }))
  }
  const out = await S.readGa4({ fetchImpl: fake, serviceAccount: secret, from: '2026-11-13', to: '2026-11-20' })
  assert.equal(bodies[0].dimensions.length, 9, 'GA4 allows at most 9 dimensions')
  assert.deepEqual(out.daily, [{
    day: '2026-11-19', event_name: 'session_start', source_medium: 'Meta_Ads / paid_social', channel: 'meta_ads', ad_content: 'Ad3',
    device: 'android', browser: 'chrome', visitor: 'new', country: 'India', users: 7, events: 7,
  }])
  assert.deepEqual(out.ab.map((r) => r.ab_tests), ['aa_check:b'], 'visitors in no test are left out')
})

test('Razorpay rows keep no personal data, and payments are linked to their settlement', async () => {
  const payment = {
    id: 'pay_1', order_id: 'order_A', created_at: 1763532000, status: 'failed', method: 'upi', amount: 84900, fee: 0, tax: 0,
    captured: false, email: 'someone@example.com', contact: '+919999999999', vpa: 'someone@upi', card_id: 'card_x',
    notes: { phone: '9999999999' }, error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment was cancelled by the user',
    error_reason: 'payment_cancelled', error_source: 'customer', error_step: 'payment_authentication', upi: { flow: 'intent', vpa: 'someone@upi' },
  }
  const row = S.rzpPaymentRow(payment)
  assert.equal(row.amount, 849)
  assert.equal(row.upi_flow, 'intent')
  const flat = JSON.stringify(row)
  for (const pii of ['someone@example.com', '9999999999', 'someone@upi', 'card_x']) assert.ok(!flat.includes(pii), `${pii} is not kept`)

  const calls = []
  const fake = async (url, init) => {
    calls.push(String(url))
    assert.match(init.headers.Authorization, /^Basic /)
    const u = new URL(url)
    if (u.pathname === '/v1/payments') {
      const skip = Number(u.searchParams.get('skip'))
      const n = skip === 0 ? 100 : 3
      return new Response(JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ ...payment, id: `pay_${skip + i}` })) }))
    }
    if (u.pathname === '/v1/settlements/recon/combined') {
      return new Response(JSON.stringify({ items: u.searchParams.get('day') === '20'
        ? [{ type: 'payment', entity_id: 'pay_3', settlement_id: 'setl_9', settled_at: 1763600000 }, { type: 'refund', entity_id: 'rfnd_1', settlement_id: 'setl_9' }]
        : [] }))
    }
    return new Response(JSON.stringify({ items: [] }))
  }
  const out = await S.readRazorpay({ fetchImpl: fake, keyId: 'rzp_live_x', keySecret: 's', from: '2026-11-19', to: '2026-11-20', nowMs: Date.parse('2026-11-20T10:00:00Z') })
  assert.equal(out.payments.length, 103, 'every page is read')
  assert.deepEqual(out.links, [{ payment_id: 'pay_3', settlement_id: 'setl_9', settled_at: new Date(1763600000 * 1000).toISOString() }])
  assert.ok(calls.every((c) => c.startsWith('https://api.razorpay.com/v1/')))
  assert.ok(calls.some((c) => c.includes('settlements/recon/combined') && c.includes('month=11') && c.includes('day=19')))
})

test('errors never carry a token', () => {
  assert.equal(S.scrub('bad token EAAB12cd and ya29.a0AfH6 and access_token=abc&x=1'), 'bad token [token] and [token] and access_token=[token]&x=1')
})

// ---------------------------------------------------------------------------
// Owner-only, and off the shop's download path
// ---------------------------------------------------------------------------
test('the dashboard tables are owner-only, and only the sync may replace days', () => {
  const sql = read('supabase/migrations/20261120120000_daily_dashboard.sql')
  for (const t of ['dash_meta_daily', 'dash_meta_slices', 'dash_ga4_daily', 'dash_ga4_items', 'dash_ga4_ab', 'dash_rzp_payments', 'dash_rzp_refunds', 'dash_rzp_settlements', 'dash_expenses', 'dash_settings', 'dash_sync_runs']) {
    assert.match(sql, new RegExp(`'${t}'`), `${t} gets row-level security and the owner-only read policy`)
  }
  assert.match(sql, /enable row level security/)
  assert.match(sql, /using \(public\.is_admin\(\)\)/)
  assert.match(sql, /revoke all on function public\.dash_replace_days\(text, date, date, jsonb\) from public, anon, authenticated;/)
  assert.match(sql, /grant execute on function public\.dash_replace_days\(text, date, date, jsonb\) to service_role;/)
  assert.match(sql, /revoke all on function public\.dash_request_sync\(\) from public, anon, authenticated;/)
  assert.match(sql, /margin_pct numeric\(5,2\) not null default 30/, 'the owner\'s 30% margin')
  assert.doesNotMatch(sql, /eyJ|rzp_live_|EAA[A-Za-z0-9]{8}|BEGIN PRIVATE KEY/, 'no secret in the migration')
  const toml = read('supabase/config.toml')
  assert.match(toml, /\[functions\.dashboard-sync\]\nverify_jwt = false/)
  const fn = read('supabase/functions/dashboard-sync/index.ts')
  assert.match(fn, /isScheduler\(req\)/)
  assert.match(fn, /callerIsAdmin\(req\.headers\.get\('authorization'\)\)/, 'otherwise only the owner')
})

test('the section is lazy-loaded with its own stylesheet, and every dn- class it uses is defined', () => {
  const dash = read('src/admin/Dashboard.jsx')
  assert.match(dash, /const DailyNumbersPanel = lazy\(\(\) => import\('\.\/daily\/DailyNumbersPanel'\)\)/)
  assert.match(dash, /\['daily', 'Daily numbers'\]/)
  assert.doesNotMatch(read('src/main.jsx'), /daily/i)
  const jsx = read('src/admin/daily/DailyNumbersPanel.jsx')
  const css = read('src/admin/daily/daily.css')
  assert.match(jsx, /import '\.\/daily\.css'/)
  const used = new Set([...jsx.matchAll(/\bdn-[a-z0-9-]+/g)].map((m) => m[0]))
  const defined = new Set([...css.matchAll(/\.(dn-[a-z0-9-]+)/g)].map((m) => m[1]))
  const missing = [...used].filter((c) => !defined.has(c) && c !== 'dn-spin')
  assert.deepEqual(missing, [], 'a class used in the markup but defined nowhere does nothing')
  const unused = [...defined].filter((c) => !used.has(c))
  assert.deepEqual(unused, [], 'a rule no markup uses is dead weight')
  // No Tailwind classes in the new files: the shop's stylesheet must not grow.
  const classLists = [...jsx.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2])
  const tailwindish = classLists.flatMap((c) => c.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)).filter((c) => c && !c.startsWith('dn-'))
  assert.deepEqual(tailwindish, [])
})
