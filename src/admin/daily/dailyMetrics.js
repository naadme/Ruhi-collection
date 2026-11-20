// "Daily numbers" (20 Nov 2026): the arithmetic behind the owner's dashboard.
//
// Pure functions only: dailyData.js reads the rows, DailyNumbersPanel.jsx draws
// them, and tests/dailyNumbers.test.js checks the sums here.
//
// Where each number comes from:
//   Meta ads   dash_meta_daily / dash_meta_slices (spend WITHOUT GST, owner's choice)
//   GA4        dash_ga4_rollup() — already filtered and summed by the database
//   Orders     orders + order_items, the only complete record of sales
//   Phones     checkout_leads (numbers typed at checkout)
//   Razorpay   dash_rzp_payments / _refunds / _settlements
//   Costs      dash_expenses, typed in by the owner; margin from dash_settings
//
// Not every source can be split every way (Meta can't split spend by device,
// GA4 doesn't know a shopper's state). A number that a chosen filter can't
// apply to is not shown at all: it says which filter it can't follow.

export const DAY_MS = 86400000
const IST_MS = 330 * 60 * 1000

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
export const istToday = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10)

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const dayCount = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1

export function daysOf(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** The India date of a timestamp. */
export const istDayOf = (iso) => (iso ? new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10) : '')

export const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['month', 'This month'],
  ['custom', 'Choose dates'],
]

/** Last 7 / 30 days end yesterday: today is still being counted. */
export function presetRange(preset, today = istToday(), custom = {}) {
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) }
    case 'last30': return { from: addDays(today, -30), to: addDays(today, -1) }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today }
    case 'custom': {
      const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
      let from = ok(custom.from) ? custom.from : addDays(today, -7)
      let to = ok(custom.to) ? custom.to : addDays(today, -1)
      if (to > today) to = today
      if (from > to) from = to
      return { from, to }
    }
    default: return { from: addDays(today, -7), to: addDays(today, -1) }
  }
}

/** The same number of days just before. */
export function previousRange({ from, to }) {
  const n = dayCount(from, to)
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

/** Monday of the week a day falls in. */
export function weekOf(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export const fmtNum = (v) => (v == null || !Number.isFinite(v) ? '–' : nf0.format(Math.round(v)))
export const fmtInr = (v) => (v == null || !Number.isFinite(v) ? '–' : `${Math.round(v) < 0 ? '−' : ''}₹${nf0.format(Math.abs(Math.round(v)))}`)
export const fmtPct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(digits)}%`)
export const fmtX = (v) => (v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(2)}x`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDay = (day) => (day ? `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}` : '')

export const ratio = (a, b) => (a == null || !b ? null : a / b)
export const change = (now, before) => (now == null || before == null || !Number.isFinite(now) || !before ? null : (now - before) / Math.abs(before))

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export const CHANNELS = [
  ['meta_ads', 'Meta ads'],
  ['google_ads', 'Google ads'],
  ['social', 'Instagram / Facebook, not ads'],
  ['search', 'Google search'],
  ['direct', 'Direct / unknown'],
  ['other', 'Other websites'],
]
export const DEVICES = [['android', 'Android phone'], ['iphone', 'iPhone'], ['computer', 'Computer'], ['other', 'Other']]
export const BROWSERS = [['in_app', 'Instagram / Facebook app'], ['chrome', 'Chrome'], ['safari', 'Safari'], ['other', 'Other']]
export const VISITORS = [['new', 'New'], ['returning', 'Returning']]

export const FILTER_LABELS = {
  channel: 'channel',
  campaign: 'campaign',
  adset: 'ad set',
  ad: 'ad',
  device: 'device',
  browser: 'browser',
  visitor: 'new / returning',
  product: 'product',
  state: 'state',
  payment: 'payment method',
  ab: 'A/B version',
}

export const EMPTY_FILTERS = Object.freeze(Object.fromEntries(Object.keys(FILTER_LABELS).map((k) => [k, ''])))

export const activeFilters = (filters) => Object.keys(FILTER_LABELS).filter((k) => filters?.[k])

/** "Solid Shirt and Pant Combo - Dark Navy Blue" → "Solid Shirt and Pant Combo" (GA4's item name). */
export const designOf = (title) => String(title ?? '').split(' - ')[0].trim()

/** The ad names a campaign / ad set / ad choice stands for (null = no ad filter). */
export function adNamesFor(filters, metaAds) {
  if (!filters.campaign && !filters.adset && !filters.ad) return null
  const names = new Set()
  for (const a of metaAds) {
    if (filters.campaign && a.campaign_name !== filters.campaign) continue
    if (filters.adset && a.adset_name !== filters.adset) continue
    if (filters.ad && a.ad_name !== filters.ad) continue
    names.add(a.ad_name)
  }
  if (filters.ad) names.add(filters.ad)
  return names
}

/** Ads, ad sets and campaigns seen in the Meta rows, for the filter lists. */
export function adCatalogue(metaDaily) {
  const seen = new Map()
  for (const r of metaDaily) {
    if (!seen.has(r.ad_id)) seen.set(r.ad_id, { ad_id: r.ad_id, ad_name: r.ad_name, adset_name: r.adset_name, campaign_name: r.campaign_name })
  }
  return [...seen.values()].sort((a, b) => a.ad_name.localeCompare(b.ad_name))
}

// Which filters each source can follow. 'channel' is special-cased below.
const SUPPORT = {
  meta: ['channel', 'campaign', 'adset', 'ad'],
  ga4: ['channel', 'campaign', 'adset', 'ad', 'device', 'browser', 'visitor'],
  ga4ab: ['ab'],
  ga4items: ['product'],
  orders: ['channel', 'campaign', 'adset', 'ad', 'visitor', 'product', 'state', 'payment', 'ab'],
  leads: ['channel', 'campaign', 'adset', 'ad'],
  money: [],
  costs: [],
}

/** The active filters a source can't follow (empty = the number is right). */
export function unsupported(source, filters) {
  const ok = SUPPORT[source] || []
  return activeFilters(filters).filter((k) => {
    if (!ok.includes(k)) return true
    // A shop order or phone number only knows "came from a Meta / Google ad" or not.
    if (k === 'channel' && (source === 'orders' || source === 'leads')) return !['meta_ads', 'google_ads'].includes(filters.channel)
    return false
  })
}

export const cantSplit = (keys) => (keys.length ? `Can't be split by ${keys.map((k) => FILTER_LABELS[k]).join(', ')}` : '')

// The GA4 table to use: the normal one, the A/B one or the products one.
export function ga4Mode(filters) {
  if (filters.ab) return 'ab'
  if (filters.product) return 'items'
  return 'main'
}

// ---------------------------------------------------------------------------
// Row filters for the shop's own data
// ---------------------------------------------------------------------------
export function orderChannel(o) {
  if (/^meta/i.test(o.utm_source || '') || o.utm_medium === 'paid_social' || o.fbc) return 'meta_ads'
  if (o.gclid || o.gbraid || o.wbraid) return 'google_ads'
  return 'not_ads'
}

export function orderMatches(o, filters, adNames) {
  if (filters.channel && orderChannel(o) !== filters.channel) return false
  if (adNames && !adNames.has(o.utm_content || '')) return false
  if (filters.visitor) {
    if (o.new_customer == null) return false
    if ((filters.visitor === 'new') !== (o.new_customer === true)) return false
  }
  if (filters.product && !(o.order_items || []).some((i) => designOf(i.title) === filters.product)) return false
  if (filters.state && (o.state || '') !== filters.state) return false
  if (filters.payment && (o.payment_type || '') !== filters.payment) return false
  if (filters.ab) {
    const [test, version] = filters.ab.split(':')
    if (!o.experiments || o.experiments[test] !== version) return false
  }
  return true
}

/** What an order is worth under the filters: its total, or only the chosen product's lines. */
export function orderValue(o, filters) {
  if (!filters.product) return Number(o.total) || 0
  return (o.order_items || [])
    .filter((i) => designOf(i.title) === filters.product)
    .reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.qty) || 0), 0)
}

export function leadMatches(l, filters, adNames) {
  if (filters.channel === 'meta_ads' && !(l.has_meta_click || /^meta/i.test(l.utm_source || ''))) return false
  if (filters.channel === 'google_ads' && !l.has_google_click) return false
  if (adNames && !adNames.has(l.utm_content || '')) return false
  return true
}

export const isPaid = (o) => o.payment_status === 'paid'

// ---------------------------------------------------------------------------
// Sums
// ---------------------------------------------------------------------------
const sum = (rows, f) => rows.reduce((s, r) => s + (Number(typeof f === 'function' ? f(r) : r[f]) || 0), 0)
const inRange = (day, { from, to }) => day >= from && day <= to

export function metaRowsFor(metaDaily, filters, range) {
  if (filters.channel && filters.channel !== 'meta_ads') return []
  return metaDaily.filter((r) =>
    inRange(r.day, range) &&
    (!filters.campaign || r.campaign_name === filters.campaign) &&
    (!filters.adset || r.adset_name === filters.adset) &&
    (!filters.ad || r.ad_name === filters.ad))
}

/** Each typed-in cost spread evenly over its days; the part that falls in the range. */
export function costsIn(expenses, range, kind) {
  let total = 0
  for (const e of expenses) {
    if (kind && e.kind !== kind) continue
    const n = dayCount(e.starts_on, e.ends_on)
    const from = e.starts_on > range.from ? e.starts_on : range.from
    const to = e.ends_on < range.to ? e.ends_on : range.to
    if (from > to) continue
    total += (Number(e.amount) / n) * dayCount(from, to)
  }
  return total
}

export function costsByDay(expenses, day, kind) {
  return costsIn(expenses, { from: day, to: day }, kind)
}

/** GA4 rollup rows → { day: { event: users } } and totals per event. */
export function ga4Index(rows, part = 'day', key = 'day') {
  const byKey = {}
  const total = {}
  for (const r of rows || []) {
    if (r.part !== part) continue
    const k = r[key] ?? ''
    byKey[k] = byKey[k] || {}
    byKey[k][r.event_name] = (byKey[k][r.event_name] || 0) + Number(r.users)
    if (part === 'day') total[r.event_name] = (total[r.event_name] || 0) + Number(r.users)
  }
  return { byKey, total }
}

// The funnel, from the ad to the bank. Each step: where it comes from and which
// GA4 event (or product-table column) it is.
export const STEPS = [
  { key: 'impressions', label: 'Saw the ad', source: 'meta' },
  { key: 'clicks', label: 'Clicked the ad', source: 'meta' },
  { key: 'session_start', label: 'Visited the shop', source: 'ga4' },
  { key: 'view_item', label: 'Viewed a product', source: 'ga4', item: 'viewed' },
  { key: 'select_size', label: 'Picked a size', source: 'ga4' },
  { key: 'add_to_cart', label: 'Added to cart', source: 'ga4', item: 'added' },
  { key: 'begin_checkout', label: 'Started checkout', source: 'ga4', item: 'checked_out' },
  // A side step: counted from the shop's own table, one row per phone number,
  // so it is shown against "Started checkout" but is never the step the next
  // one is measured against.
  { key: 'leads', label: 'Typed a phone number', source: 'leads', side: true },
  { key: 'add_shipping_info', label: 'Sent an address', source: 'ga4' },
  { key: 'pay_window', label: 'Opened the payment window', source: 'orders' },
  { key: 'tried', label: 'Tried to pay', source: 'orders' },
  { key: 'paid', label: 'Paid', source: 'orders' },
  // Settling takes Razorpay ~2 working days: a low share here is usually
  // timing, not shoppers leaving, so it is never called the biggest drop.
  { key: 'settled', label: 'Money reached the bank', source: 'orders', timing: true },
]

/**
 * Everything one period needs. `data` holds that period's rows:
 *   metaDaily, ga4 (rollup rows), ga4Ab (rows), ga4Items (per-day rows of one
 *   product), orders (with order_items), leads, attempts, expenses.
 */
export function periodTotals({ data, filters, range, metaAds, margin }) {
  const adNames = adNamesFor(filters, metaAds)
  const meta = metaRowsFor(data.metaDaily, filters, range)
  const orders = data.orders.filter((o) => inRange(istDayOf(o.created_at), range) && orderMatches(o, filters, adNames))
  const paid = orders.filter(isPaid)
  const leads = data.leads.filter((l) => inRange(istDayOf(l.last_seen_at), range) && leadMatches(l, filters, adNames))
  const attemptsByOrder = new Map()
  for (const a of data.attempts) {
    if (!a.rzp_order_id) continue
    const list = attemptsByOrder.get(a.rzp_order_id) || []
    list.push(a)
    attemptsByOrder.set(a.rzp_order_id, list)
  }

  const mode = ga4Mode(filters)
  const ga4Total = {}
  if (mode === 'main') Object.assign(ga4Total, ga4Index(data.ga4).total)
  if (mode === 'ab') for (const r of data.ga4Ab || []) ga4Total[r.event_name] = (ga4Total[r.event_name] || 0) + Number(r.users)
  const itemTotal = {}
  if (mode === 'items') for (const r of data.ga4Items || []) for (const c of ['viewed', 'added', 'checked_out', 'purchased']) itemTotal[c] = (itemTotal[c] || 0) + Number(r[c])

  const noMeta = unsupported('meta', filters)
  const noOrders = unsupported('orders', filters)
  const noLeads = unsupported('leads', filters)
  // GA4's own filters can't be combined with an A/B or product choice.
  const ga4Unsupported = mode === 'main'
    ? unsupported('ga4', filters)
    : activeFilters(filters).filter((k) => k !== (mode === 'ab' ? 'ab' : 'product'))

  const metaSpend = sum(meta, 'spend')
  const filtered = activeFilters(filters).length > 0
  const marketingCosts = filtered ? 0 : costsIn(data.expenses, range, 'marketing')
  const otherCosts = filtered ? 0 : costsIn(data.expenses, range, 'other')
  const adSpend = noMeta.length ? null : metaSpend + marketingCosts
  const revenue = noOrders.length ? null : sum(paid, (o) => orderValue(o, filters))
  const adPaid = paid.filter((o) => orderChannel(o) === 'meta_ads')
  const adRevenue = noOrders.length ? null : sum(adPaid, (o) => orderValue(o, filters))

  const step = {}
  const na = {}
  const setStep = (key, value, missing) => {
    if (missing.length) { step[key] = null; na[key] = cantSplit(missing) } else step[key] = value
  }
  setStep('impressions', sum(meta, 'impressions'), noMeta)
  setStep('clicks', sum(meta, 'link_clicks'), noMeta)
  for (const s of STEPS.filter((x) => x.source === 'ga4')) {
    if (mode === 'items') {
      if (s.item) setStep(s.key, itemTotal[s.item] || 0, ga4Unsupported)
      else { step[s.key] = null; na[s.key] = 'GA4 counts products only from "Viewed a product" on' }
    } else if (mode === 'ab' && s.key === 'session_start') {
      // GA4's automatic visit event carries no A/B version (the shop adds it
      // to its own events), so visitors per version can't be counted.
      step[s.key] = null
      na[s.key] = 'GA4 records the A/B version from "Viewed a product" on'
    } else setStep(s.key, ga4Total[s.key] || 0, ga4Unsupported)
  }
  setStep('leads', leads.length, noLeads)
  const payWindow = orders.filter((o) => o.razorpay_order_id)
  setStep('pay_window', payWindow.length, noOrders)
  setStep('tried', payWindow.filter((o) => attemptsByOrder.has(o.razorpay_order_id)).length, noOrders)
  setStep('paid', paid.length, noOrders)
  setStep('settled', paid.filter((o) => (attemptsByOrder.get(o.razorpay_order_id) || []).some((a) => a.settlement_id)).length, noOrders)

  const marginRate = (Number(margin) || 30) / 100
  return {
    range,
    adSpend,
    metaSpend: noMeta.length ? null : metaSpend,
    marketingCosts,
    otherCosts,
    revenue,
    adRevenue,
    paidOrders: noOrders.length ? null : paid.length,
    adPaidOrders: noOrders.length ? null : adPaid.length,
    aov: revenue == null ? null : ratio(revenue, paid.length),
    pieces: noOrders.length ? null : sum(paid, (o) => sum(o.order_items || [], 'qty')),
    roas: adSpend == null || revenue == null ? null : ratio(revenue, adSpend),
    adRoas: noMeta.length || adRevenue == null ? null : ratio(adRevenue, metaSpend),
    costPerOrder: adSpend == null || noOrders.length ? null : ratio(adSpend, paid.length),
    profit: adSpend == null || revenue == null ? null : revenue * marginRate - adSpend - otherCosts,
    breakEvenRoas: 1 / marginRate,
    unpaidOrders: noOrders.length ? null : orders.filter((o) => !isPaid(o) && o.razorpay_order_id).length,
    unpaidValue: noOrders.length ? null : sum(orders.filter((o) => !isPaid(o) && o.razorpay_order_id), 'total'),
    step,
    na,
    notes: {
      adSpend: noMeta.length ? cantSplit(noMeta) : filtered ? 'Meta only: typed-in costs count when no filter is on' : '',
      revenue: noOrders.length ? cantSplit(noOrders) : filters.product ? 'Only this product\'s lines' : '',
    },
    ga4Mode: mode,
    channel: filters.channel || '',
    adFiltered: adNames != null,
  }
}

// Visitors include people who never saw an ad, so "Visited the shop" is
// measured against "Clicked the ad" only when the channel filter is Meta ads
// or a campaign, ad set or ad is chosen.
const comparable = (step, totals) => step.key !== 'session_start' || totals.channel === 'meta_ads' || totals.adFiltered

/** The funnel rows: count, share of the step before, cost each, change. */
export function funnelRows(now, before) {
  const rows = []
  let prev = null
  for (const s of STEPS) {
    const value = now.step[s.key]
    const ok = comparable(s, now)
    rows.push({
      ...s,
      value,
      na: now.na[s.key] || '',
      ofPrevious: value != null && prev != null && ok ? ratio(value, prev) : null,
      hint: !ok && value != null ? 'All visitors, not only from ads' : '',
      costEach: value != null && now.adSpend != null && s.key !== 'impressions' ? ratio(now.adSpend, value) : null,
      change: before && value != null && before.step[s.key] != null ? change(value, before.step[s.key]) : null,
    })
    if (value != null && !s.side) prev = value
  }
  return rows
}

/** The step that lost the most people compared with the period before. */
export function biggestDrop(now, before) {
  if (!before) return null
  let worst = null
  let prevNow = null
  let prevBefore = null
  for (const s of STEPS) {
    if (s.side || s.timing) continue
    const a = now.step[s.key]
    const b = before.step[s.key]
    if (a != null && b != null && prevNow && prevBefore && comparable(s, now)) {
      const rateNow = a / prevNow
      const rateBefore = b / prevBefore
      const diff = rateNow - rateBefore
      if (rateBefore > 0 && diff < 0 && (!worst || diff < worst.diff)) worst = { key: s.key, label: s.label, rateNow, rateBefore, diff }
    }
    if (a != null) prevNow = a
    if (b != null) prevBefore = b
  }
  return worst
}

/** One row per day (or per week): the main numbers side by side. */
export function dailyRows({ data, filters, range, metaAds, groupBy = 'day' }) {
  const adNames = adNamesFor(filters, metaAds)
  const meta = metaRowsFor(data.metaDaily, filters, range)
  const mode = ga4Mode(filters)
  const ga4ByDay = mode === 'main' ? ga4Index(data.ga4).byKey : {}
  if (mode === 'ab') for (const r of data.ga4Ab || []) { ga4ByDay[r.day] = ga4ByDay[r.day] || {}; ga4ByDay[r.day][r.event_name] = (ga4ByDay[r.day][r.event_name] || 0) + Number(r.users) }
  if (mode === 'items') for (const r of data.ga4Items || []) { if (!r.day) continue; ga4ByDay[r.day] = { session_start: null, add_to_cart: Number(r.added), begin_checkout: Number(r.checked_out) } }
  const noMeta = unsupported('meta', filters).length > 0
  const noOrders = unsupported('orders', filters).length > 0
  const filtered = activeFilters(filters).length > 0
  const groups = new Map()
  for (const day of daysOf(range.from, range.to)) {
    const key = groupBy === 'week' ? weekOf(day) : day
    const g = groups.get(key) || { key, days: 0, spend: 0, visitors: 0, atc: 0, checkouts: 0, orders: 0, paid: 0, revenue: 0, noVisitors: mode !== 'main' }
    g.days += 1
    g.spend += sum(meta.filter((r) => r.day === day), 'spend') + (filtered ? 0 : costsByDay(data.expenses, day, 'marketing'))
    const ga = ga4ByDay[day] || {}
    g.visitors += ga.session_start || 0
    g.atc += ga.add_to_cart || 0
    g.checkouts += ga.begin_checkout || 0
    const orders = data.orders.filter((o) => istDayOf(o.created_at) === day && orderMatches(o, filters, adNames))
    g.orders += orders.filter((o) => o.razorpay_order_id).length
    const paid = orders.filter(isPaid)
    g.paid += paid.length
    g.revenue += sum(paid, (o) => orderValue(o, filters))
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => ({
    ...g,
    spend: noMeta ? null : g.spend,
    visitors: g.noVisitors ? null : g.visitors,
    orders: noOrders ? null : g.orders,
    paid: noOrders ? null : g.paid,
    revenue: noOrders ? null : g.revenue,
    roas: noMeta || noOrders ? null : ratio(g.revenue, g.spend),
  }))
}

/** One row per Meta ad: what it cost, how people reacted, what it sold. */
export function adRows({ data, filters, range, metaAds }) {
  const meta = metaRowsFor(data.metaDaily, filters, range)
  const ga4ByAd = ga4Index(data.ga4, 'ad', 'key').byKey
  const paidByAd = new Map()
  for (const o of data.orders) {
    if (!isPaid(o) || !inRange(istDayOf(o.created_at), range)) continue
    if (!orderMatches(o, { ...filters, campaign: '', adset: '', ad: '' }, null)) continue
    const k = o.utm_content || ''
    const g = paidByAd.get(k) || { n: 0, value: 0 }
    g.n += 1
    g.value += orderValue(o, filters)
    paidByAd.set(k, g)
  }
  const byAd = new Map()
  for (const r of meta) {
    const g = byAd.get(r.ad_id) || { ad_id: r.ad_id, ad_name: r.ad_name, adset_name: r.adset_name, campaign_name: r.campaign_name, spend: 0, impressions: 0, link_clicks: 0, video_3s: 0, video_p25: 0, add_to_cart: 0, purchases: 0 }
    for (const k of ['spend', 'impressions', 'link_clicks', 'video_3s', 'video_p25', 'add_to_cart', 'purchases']) g[k] += Number(r[k]) || 0
    byAd.set(r.ad_id, g)
  }
  return [...byAd.values()].map((g) => {
    const shop = paidByAd.get(g.ad_name) || { n: 0, value: 0 }
    const visitors = ga4ByAd[g.ad_name]?.session_start ?? 0
    return {
      ...g,
      ctr: ratio(g.link_clicks, g.impressions),
      hookRate: ratio(g.video_3s, g.impressions),
      quarterRate: ratio(g.video_p25, g.impressions),
      costPerAtc: ratio(g.spend, g.add_to_cart),
      visitors,
      paid: shop.n,
      revenue: shop.value,
      roas: ratio(shop.value, g.spend),
    }
  }).sort((a, b) => b.spend - a.spend)
}

/** Placements or age groups (Meta's own split). */
export function sliceRows(metaSlices, kind, range) {
  const by = new Map()
  for (const r of metaSlices) {
    if (r.kind !== kind || !inRange(r.day, range)) continue
    const g = by.get(r.slice) || { slice: r.slice, spend: 0, impressions: 0, link_clicks: 0, add_to_cart: 0, purchases: 0 }
    for (const k of ['spend', 'impressions', 'link_clicks', 'add_to_cart', 'purchases']) g[k] += Number(r[k]) || 0
    by.set(r.slice, g)
  }
  return [...by.values()]
    .map((g) => ({ ...g, ctr: ratio(g.link_clicks, g.impressions), costPerAtc: ratio(g.spend, g.add_to_cart) }))
    .filter((g) => g.spend > 0.5 || g.link_clicks > 0)
    .sort((a, b) => b.spend - a.spend)
}

/** Visitors and their steps by channel (GA4), with paid orders where the shop knows them. */
export function channelRows({ data, range }) {
  const by = ga4Index(data.ga4, 'channel', 'key').byKey
  const paid = data.orders.filter((o) => isPaid(o) && inRange(istDayOf(o.created_at), range))
  return CHANNELS.map(([key, label]) => {
    const g = by[key] || {}
    return {
      key,
      label,
      visitors: g.session_start || 0,
      viewed: g.view_item || 0,
      atc: g.add_to_cart || 0,
      checkouts: g.begin_checkout || 0,
      paid: key === 'meta_ads' || key === 'google_ads' ? paid.filter((o) => orderChannel(o) === key).length : null,
    }
  }).filter((r) => r.visitors || r.atc || r.paid)
}

/** Payment attempts: how many worked, by method, and why the others failed. */
export function paymentSummary(attempts) {
  const byMethod = new Map()
  const reasons = new Map()
  const orders = new Map()
  for (const a of attempts) {
    const m = a.method || 'unknown'
    const g = byMethod.get(m) || { method: m, attempts: 0, ok: 0 }
    g.attempts += 1
    if (a.captured || a.status === 'captured' || a.status === 'refunded') g.ok += 1
    byMethod.set(m, g)
    if (a.status === 'failed') {
      const why = a.error_description || a.error_reason || a.error_code || 'No reason given'
      const r = reasons.get(why) || { reason: why, step: a.error_step || '', source: a.error_source || '', n: 0 }
      r.n += 1
      reasons.set(why, r)
    }
    if (a.rzp_order_id) {
      const o = orders.get(a.rzp_order_id) || { tries: 0, ok: false }
      o.tries += 1
      o.ok = o.ok || a.captured === true
      orders.set(a.rzp_order_id, o)
    }
  }
  const tried = [...orders.values()]
  return {
    attempts: attempts.length,
    ok: [...byMethod.values()].reduce((s, g) => s + g.ok, 0),
    failed: attempts.filter((a) => a.status === 'failed').length,
    ordersTried: tried.length,
    ordersPaid: tried.filter((o) => o.ok).length,
    byMethod: [...byMethod.values()].sort((a, b) => b.attempts - a.attempts),
    reasons: [...reasons.values()].sort((a, b) => b.n - a.n),
  }
}

/** Money through Razorpay in the range, and what is still waiting to reach the bank. */
export function moneySummary({ attempts, refunds, settlements, allCaptured, range }) {
  const captured = attempts.filter((a) => a.captured && inRange(a.day, range))
  return {
    collected: sum(captured, 'amount'),
    fees: sum(captured, 'fee'),
    feesGst: sum(captured, 'tax'),
    refunds: sum(refunds.filter((r) => inRange(r.day, range)), 'amount'),
    settled: sum(settlements.filter((s) => inRange(s.day, range)), 'amount'),
    settlements: settlements.filter((s) => inRange(s.day, range)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    waiting: sum((allCaptured || []).filter((a) => !a.settlement_id), (a) => (Number(a.amount) || 0) - (Number(a.fee) || 0) - (Number(a.amount_refunded) || 0)),
  }
}

/** Products: GA4's views and carts beside the pieces actually paid for. */
export function productRows({ itemTotals, orders, range }) {
  const paid = new Map()
  for (const o of orders) {
    if (!isPaid(o) || !inRange(istDayOf(o.created_at), range)) continue
    for (const i of o.order_items || []) {
      const d = designOf(i.title)
      const g = paid.get(d) || { pieces: 0, value: 0 }
      g.pieces += Number(i.qty) || 0
      g.value += (Number(i.unit_price) || 0) * (Number(i.qty) || 0)
      paid.set(d, g)
    }
  }
  const names = new Set([...(itemTotals || []).map((r) => r.item_name), ...paid.keys()])
  return [...names].map((name) => {
    const g = (itemTotals || []).find((r) => r.item_name === name) || {}
    const p = paid.get(name) || { pieces: 0, value: 0 }
    return {
      name,
      viewed: Number(g.viewed) || 0,
      added: Number(g.added) || 0,
      addRate: ratio(Number(g.added) || 0, Number(g.viewed) || 0),
      pieces: p.pieces,
      value: p.value,
    }
  }).sort((a, b) => b.viewed - a.viewed || b.pieces - a.pieces)
}

/** The health checks: things that are wrong whatever the filters. */
export function checks({ orders, ga4Purchases, metaPurchases, allAttempts, metaAccount, metaSpendLast7, runs, range, now = Date.now() }) {
  const out = []
  const paid = orders.filter((o) => isPaid(o) && inRange(istDayOf(o.created_at), range))
  const adPaid = paid.filter((o) => orderChannel(o) === 'meta_ads')
  out.push({
    key: 'tracking',
    label: 'Sales reaching GA4 and Meta',
    bad: ga4Purchases != null && ga4Purchases < paid.length,
    text: `${paid.length} paid orders · GA4 counted ${ga4Purchases ?? '–'} · Meta counted ${metaPurchases ?? '–'} of ${adPaid.length} from ads`,
  })
  const capturedOrders = new Set(allAttempts.filter((a) => a.captured && a.rzp_order_id).map((a) => a.rzp_order_id))
  const stuck = orders.filter((o) => !isPaid(o) && o.razorpay_order_id && capturedOrders.has(o.razorpay_order_id))
  out.push({
    key: 'stuck',
    label: 'Paid but still "pending"',
    bad: stuck.length > 0,
    text: stuck.length ? `${stuck.length}: ${stuck.map((o) => o.reference).join(', ')}. Razorpay has the money; the order doesn't know.` : 'None',
  })
  const unpaid = orders.filter((o) => !isPaid(o) && o.razorpay_order_id && inRange(istDayOf(o.created_at), range))
  out.push({
    key: 'unpaid',
    label: 'Opened payment, didn\'t pay',
    bad: false,
    text: `${unpaid.length} orders · ${fmtInr(sum(unpaid, 'total'))}`,
  })
  if (metaAccount) {
    const left = (Number(metaAccount.spend_cap) || 0) - (Number(metaAccount.amount_spent) || 0)
    const perDay = metaSpendLast7 / 7
    const days = perDay > 0 ? left / perDay : null
    out.push({
      key: 'balance',
      label: 'Meta prepaid balance',
      bad: days != null && days < 2,
      text: `${fmtInr(left)} left${days != null ? ` · ${days < 1 ? 'less than a day' : `about ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`} at ${fmtInr(perDay)} a day` : ''}`,
    })
  }
  for (const src of ['meta', 'ga4', 'razorpay']) {
    const lastOk = runs.find((r) => r.sources?.[src]?.ok)
    const last = runs.find((r) => r.sources?.[src])
    const failed = last && !last.sources[src].ok
    const ageH = lastOk ? (now - Date.parse(lastOk.finished_at || lastOk.started_at)) / 3600000 : null
    out.push({
      key: `fresh-${src}`,
      label: `${src === 'ga4' ? 'GA4' : src === 'meta' ? 'Meta' : 'Razorpay'} data`,
      bad: failed || ageH == null || ageH > 3,
      text: lastOk ? `Updated ${ageH < 1 ? `${Math.max(1, Math.round(ageH * 60))} min` : `${Math.round(ageH)} h`} ago${failed ? ` · last try failed: ${last.sources[src].error || 'no detail'}` : ''}` : failed ? `Not read yet: ${last.sources[src].error || 'no detail'}` : 'Not read yet',
    })
  }
  return out
}
