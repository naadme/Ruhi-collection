// The "Daily numbers" sync (20 Nov 2026): reads Meta ads, GA4 and Razorpay and
// turns their answers into rows for the dash_* tables
// (supabase/migrations/20261120120000_daily_dashboard.sql).
//
// Plain JavaScript with no Deno or Node imports, so the Edge Function runs it
// and the Node tests (tests/dailyDashboardSync.test.js) check it with fake API
// answers. Every reader takes the `fetch` to use.
//
// Read-only everywhere: GA4 through a Viewer service account, Meta through a
// system user's ads_read token, Razorpay with GET requests only. No personal
// data is kept: no names, phones, emails, UPI IDs or card numbers.

export const META_AD_ACCOUNT = 'act_1098399405121569'
export const META_VERSION = 'v25.0'
export const GA4_PROPERTY = '563216747'
// The first sync reads back to here; later runs re-read the last 7 days.
export const BACKFILL_FROM = '2026-10-01'
export const REREAD_DAYS = 7

// ---------------------------------------------------------------------------
// Dates (India time: the shop, GA4 and the Meta ad account all use IST)
// ---------------------------------------------------------------------------
const IST_MS = 330 * 60 * 1000

export function istDay(ms = Date.now()) {
  return new Date(ms + IST_MS).toISOString().slice(0, 10)
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Unix seconds of midnight IST at the start of `day`. */
export function istMidnight(day) {
  return Math.floor((Date.parse(`${day}T00:00:00Z`) - IST_MS) / 1000)
}

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/**
 * The days a run re-reads: the last 7, or everything on the first run.
 * @param {{ today?: string, firstRun?: boolean, from?: unknown }} [options]
 */
export function syncRange({ today = istDay(), firstRun = false, from = undefined } = {}) {
  let start = firstRun ? BACKFILL_FROM : addDays(today, -REREAD_DAYS)
  if (isDay(from) && from >= BACKFILL_FROM && from < start) start = from
  return { from: start, to: today }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const int = (v) => Math.round(num(v))
const money = (v) => Math.round(num(v) * 100) / 100
const paise = (v) => Math.round(num(v)) / 100
const text = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max))

/** A token never appears in an error the sync stores or returns. */
export function scrub(message) {
  return String(message ?? '')
    .replace(/EAA[A-Za-z0-9]+/g, '[token]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[token]')
    .replace(/access_token=[^&\s]+/g, 'access_token=[token]')
    .slice(0, 300)
}

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const utf8 = (s) => new TextEncoder().encode(s)

// ---------------------------------------------------------------------------
// Meta ads
// ---------------------------------------------------------------------------
// The first of these Meta reports is used. Pixel events first: they are what
// the shop's own Meta pixel saw.
export const META_ACTIONS = {
  link_click: ['link_click'],
  landing_page_view: ['landing_page_view', 'omni_landing_page_view'],
  video_3s: ['video_view'],
  add_to_cart: ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart', 'add_to_cart'],
  checkouts: ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout', 'initiate_checkout'],
  payment_info: ['offsite_conversion.fb_pixel_add_payment_info', 'add_payment_info'],
  purchases: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
}

export function metaAction(list, key) {
  if (!Array.isArray(list)) return 0
  for (const type of META_ACTIONS[key] || [key]) {
    const hit = list.find((a) => a && a.action_type === type)
    if (hit) return num(hit.value)
  }
  return 0
}

export function metaAdRow(r) {
  return {
    day: r.date_start,
    ad_id: text(r.ad_id, 40),
    ad_name: text(r.ad_name),
    adset_id: text(r.adset_id, 40),
    adset_name: text(r.adset_name),
    campaign_id: text(r.campaign_id, 40),
    campaign_name: text(r.campaign_name),
    spend: money(r.spend),
    impressions: int(r.impressions),
    reach: int(r.reach),
    link_clicks: int(r.inline_link_clicks),
    landing_page_views: int(metaAction(r.actions, 'landing_page_view')),
    video_3s: int(metaAction(r.actions, 'video_3s')),
    video_p25: int(metaAction(r.video_p25_watched_actions, 'video_3s')),
    add_to_cart: int(metaAction(r.actions, 'add_to_cart')),
    checkouts: int(metaAction(r.actions, 'checkouts')),
    payment_info: int(metaAction(r.actions, 'payment_info')),
    purchases: int(metaAction(r.actions, 'purchases')),
    purchase_value: money(metaAction(r.action_values, 'purchases')),
  }
}

export function metaSliceRow(r, kind) {
  const slice = kind === 'age'
    ? text(r.age, 40) || 'unknown'
    : [r.publisher_platform, r.platform_position].filter(Boolean).map((s) => text(s, 40)).join(' · ') || 'unknown'
  return {
    day: r.date_start,
    kind,
    slice,
    spend: money(r.spend),
    impressions: int(r.impressions),
    link_clicks: int(r.inline_link_clicks),
    add_to_cart: int(metaAction(r.actions, 'add_to_cart')),
    purchases: int(metaAction(r.actions, 'purchases')),
    purchase_value: money(metaAction(r.action_values, 'purchases')),
  }
}

/** Same day + slice can come back twice (Meta splits some placements): add them up. */
export function sumByKey(rows, keyOf, numericKeys) {
  const out = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    const prev = out.get(k)
    if (!prev) out.set(k, { ...r })
    else for (const n of numericKeys) prev[n] = Math.round((num(prev[n]) + num(r[n])) * 100) / 100
  }
  return [...out.values()]
}

async function metaGetAll(fetchImpl, token, path, params) {
  const url = new URL(`https://graph.facebook.com/${META_VERSION}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const rows = []
  let next = url.toString()
  for (let page = 0; next && page < 50; page += 1) {
    const res = await fetchImpl(next, { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Meta ${res.status}: ${scrub(body?.error?.message || 'no detail')}`)
    if (Array.isArray(body.data)) rows.push(...body.data)
    else if (page === 0) return body
    next = body?.paging?.next || ''
  }
  return rows
}

export async function readMeta({ fetchImpl = fetch, token, from, to }) {
  if (!token) throw new Error('META_ADS_READ_TOKEN is not set')
  const common = {
    time_range: JSON.stringify({ since: from, until: to }),
    time_increment: '1',
    use_unified_attribution_setting: 'true',
    limit: '500',
  }
  const adFields = [
    'date_start', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
    'spend', 'impressions', 'reach', 'inline_link_clicks', 'actions', 'action_values', 'video_p25_watched_actions',
  ].join(',')
  const sliceFields = 'date_start,spend,impressions,inline_link_clicks,actions,action_values'
  const insights = `${META_AD_ACCOUNT}/insights`
  const ads = await metaGetAll(fetchImpl, token, insights, { ...common, level: 'ad', fields: adFields })
  const placements = await metaGetAll(fetchImpl, token, insights, {
    ...common, level: 'account', fields: sliceFields, breakdowns: 'publisher_platform,platform_position',
  })
  const ages = await metaGetAll(fetchImpl, token, insights, { ...common, level: 'account', fields: sliceFields, breakdowns: 'age' })
  const account = await metaGetAll(fetchImpl, token, META_AD_ACCOUNT, { fields: 'currency,spend_cap,amount_spent,balance' })
  const sliceNums = ['spend', 'impressions', 'link_clicks', 'add_to_cart', 'purchases', 'purchase_value']
  return {
    daily: (Array.isArray(ads) ? ads : []).map(metaAdRow).filter((r) => r.day && r.ad_id),
    slices: sumByKey(
      [
        ...(Array.isArray(placements) ? placements : []).map((r) => metaSliceRow(r, 'placement')),
        ...(Array.isArray(ages) ? ages : []).map((r) => metaSliceRow(r, 'age')),
      ].filter((r) => r.day),
      (r) => `${r.day}|${r.kind}|${r.slice}`,
      sliceNums,
    ),
    // Prepaid account: money usable = spend_cap (money added less 18% GST);
    // left ≈ spend_cap − amount_spent. Both arrive in paise.
    account: account && !Array.isArray(account)
      ? {
          currency: text(account.currency, 8),
          spend_cap: paise(account.spend_cap),
          amount_spent: paise(account.amount_spent),
          balance: paise(account.balance),
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------
export const GA4_EVENTS = [
  'session_start', 'view_item', 'select_size', 'add_to_cart', 'begin_checkout',
  'add_shipping_info', 'add_payment_info', 'purchase',
]

const TEST_SOURCES = new Set([
  'tagassistant.google.com', 'adsmanager.facebook.com', 'business.facebook.com', 'localhost',
])

/** Which way a visit came, from GA4's "source / medium". */
export function channelOf(sourceMedium) {
  const [rawSource = '', rawMedium = ''] = String(sourceMedium ?? '').split(' / ')
  const s = rawSource.trim().toLowerCase()
  const m = rawMedium.trim().toLowerCase()
  if (TEST_SOURCES.has(s) || s.endsWith('.vercel.app') || s.startsWith('127.0.0.1')) return 'test'
  if (s === 'meta_ads' || m === 'paid_social') return 'meta_ads'
  if (s === 'google' && ['cpc', 'ppc', 'paid', 'paidsearch'].includes(m)) return 'google_ads'
  if (['ig', 'fb', 'instagram', 'facebook'].includes(s) || /(^|\.)(instagram|facebook)\.com$/.test(s) || m === 'social') return 'social'
  if (m === 'organic' || /(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$/.test(s)) return 'search'
  if (s === '(direct)') return 'direct'
  return 'other'
}

export function deviceOf(category, os) {
  const c = String(category ?? '').toLowerCase()
  const o = String(os ?? '').toLowerCase()
  if (c === 'desktop') return 'computer'
  if (o === 'android') return 'android'
  if (o === 'ios') return 'iphone'
  return 'other'
}

export function browserOf(browser) {
  const b = String(browser ?? '').toLowerCase()
  if (b === 'android webview' || b === 'safari (in-app)') return 'in_app'
  if (b === 'chrome') return 'chrome'
  if (b === 'safari') return 'safari'
  return 'other'
}

export function visitorOf(value) {
  const v = String(value ?? '').toLowerCase()
  return v === 'new' || v === 'returning' ? v : 'unknown'
}

const ga4Day = (yyyymmdd) => {
  const s = String(yyyymmdd ?? '')
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''
}

function ga4Rows(block) {
  const dims = (block?.dimensionHeaders || []).map((h) => h.name)
  const mets = (block?.metricHeaders || []).map((h) => h.name)
  return (block?.rows || []).map((r) => {
    const row = {}
    dims.forEach((d, i) => { row[d] = r.dimensionValues?.[i]?.value ?? '' })
    mets.forEach((m, i) => { if (row[m] === undefined) row[m] = num(r.metricValues?.[i]?.value) })
    return row
  })
}

export function ga4DailyRows(rows) {
  const mapped = rows.map((r) => ({
    day: ga4Day(r.date),
    event_name: text(r.eventName, 40),
    source_medium: text(r.sessionSourceMedium, 120),
    channel: channelOf(r.sessionSourceMedium),
    ad_content: text(r.sessionManualAdContent, 120) === '(not set)' ? '' : text(r.sessionManualAdContent, 120),
    device: deviceOf(r.deviceCategory, r.operatingSystem),
    browser: browserOf(r.browser),
    visitor: visitorOf(r.newVsReturning),
    country: text(r.country, 60),
    users: int(r.totalUsers),
    events: int(r.eventCount),
  })).filter((r) => r.day)
  const keys = ['day', 'event_name', 'source_medium', 'channel', 'ad_content', 'device', 'browser', 'visitor', 'country']
  return sumByKey(mapped, (r) => keys.map((k) => r[k]).join('|'), ['users', 'events'])
}

export function ga4ItemRows(rows) {
  return rows.map((r) => ({
    day: ga4Day(r.date),
    item_name: text(r.itemName, 160),
    viewed: int(r.itemsViewed),
    added: int(r.itemsAddedToCart),
    checked_out: int(r.itemsCheckedOut),
    purchased: int(r.itemsPurchased),
    revenue: money(r.itemRevenue),
  })).filter((r) => r.day && r.item_name && r.item_name !== '(not set)')
}

export function ga4AbRows(rows) {
  return rows.map((r) => ({
    day: ga4Day(r.date),
    event_name: text(r.eventName, 40),
    ab_tests: text(r['customEvent:ab_tests'], 200),
    users: int(r.totalUsers),
    events: int(r.eventCount),
  })).filter((r) => r.day && r.ab_tests && r.ab_tests !== '(not set)')
}

/** The service-account key: the JSON itself, or its base64 (as kept in the Mac's Keychain). */
export function parseServiceAccount(secret) {
  const raw = String(secret ?? '').trim()
  if (!raw) throw new Error('GA4_SERVICE_ACCOUNT is not set')
  const json = raw.startsWith('{') ? raw : new TextDecoder().decode(b64ToBytes(raw))
  const key = JSON.parse(json)
  if (!key.client_email || !key.private_key) throw new Error('GA4_SERVICE_ACCOUNT is not a service-account key')
  return key
}

export async function googleAccessToken(fetchImpl, key, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  const header = bytesToB64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id })))
  const claims = bytesToB64url(utf8(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })))
  const pem = key.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', b64ToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, utf8(`${header}.${claims}`)))
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${bytesToB64url(signature)}`,
    }).toString(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed (${res.status} ${scrub(body.error || '')})`)
  return body.access_token
}

async function ga4Report(fetchImpl, token, body) {
  const rows = []
  for (let offset = 0, page = 0; page < 20; page += 1) {
    const res = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, limit: 100000, offset }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`GA4 ${res.status}: ${scrub(json?.error?.message || 'no detail')}`)
    const got = ga4Rows(json)
    rows.push(...got)
    offset += got.length
    if (!got.length || offset >= num(json.rowCount)) break
  }
  return rows
}

export async function readGa4({ fetchImpl = fetch, serviceAccount, from, to }) {
  const key = parseServiceAccount(serviceAccount)
  const token = await googleAccessToken(fetchImpl, key)
  const dateRanges = [{ startDate: from, endDate: to }]
  const events = { filter: { fieldName: 'eventName', inListFilter: { values: GA4_EVENTS } } }
  const dims = (names) => names.map((name) => ({ name }))
  const mets = (names) => names.map((name) => ({ name }))
  const main = await ga4Report(fetchImpl, token, {
    dateRanges,
    // GA4 allows 9 dimensions; campaign and ad set come from the ad name.
    dimensions: dims(['date', 'eventName', 'sessionSourceMedium', 'sessionManualAdContent', 'deviceCategory',
      'operatingSystem', 'browser', 'newVsReturning', 'country']),
    metrics: mets(['totalUsers', 'eventCount']),
    dimensionFilter: events,
  })
  const items = await ga4Report(fetchImpl, token, {
    dateRanges,
    dimensions: dims(['date', 'itemName']),
    metrics: mets(['itemsViewed', 'itemsAddedToCart', 'itemsCheckedOut', 'itemsPurchased', 'itemRevenue']),
  })
  const ab = await ga4Report(fetchImpl, token, {
    dateRanges,
    dimensions: dims(['date', 'eventName', 'customEvent:ab_tests']),
    metrics: mets(['totalUsers', 'eventCount']),
    dimensionFilter: events,
  })
  return { daily: ga4DailyRows(main), items: ga4ItemRows(items), ab: ga4AbRows(ab) }
}

// ---------------------------------------------------------------------------
// Razorpay (live account)
// ---------------------------------------------------------------------------
export function rzpPaymentRow(p) {
  const created = num(p.created_at) * 1000
  return {
    id: text(p.id, 40),
    rzp_order_id: p.order_id ? text(p.order_id, 40) : null,
    created_at: new Date(created).toISOString(),
    day: istDay(created),
    status: text(p.status, 20),
    method: p.method ? text(p.method, 20) : null,
    amount: paise(p.amount),
    fee: paise(p.fee),
    tax: paise(p.tax),
    amount_refunded: paise(p.amount_refunded),
    captured: p.captured === true,
    error_code: p.error_code ? text(p.error_code, 60) : null,
    error_reason: p.error_reason ? text(p.error_reason, 80) : null,
    error_source: p.error_source ? text(p.error_source, 40) : null,
    error_step: p.error_step ? text(p.error_step, 40) : null,
    error_description: p.error_description ? text(p.error_description, 200) : null,
    upi_flow: p.upi && typeof p.upi === 'object' && p.upi.flow ? text(p.upi.flow, 20) : null,
    updated_at: new Date().toISOString(),
  }
}

export function rzpRefundRow(r) {
  const created = num(r.created_at) * 1000
  return {
    id: text(r.id, 40),
    payment_id: r.payment_id ? text(r.payment_id, 40) : null,
    created_at: new Date(created).toISOString(),
    day: istDay(created),
    amount: paise(r.amount),
    status: r.status ? text(r.status, 20) : null,
  }
}

export function rzpSettlementRow(s) {
  const created = num(s.created_at) * 1000
  return {
    id: text(s.id, 40),
    created_at: new Date(created).toISOString(),
    day: istDay(created),
    amount: paise(s.amount),
    fees: paise(s.fees),
    tax: paise(s.tax),
    status: s.status ? text(s.status, 20) : null,
    utr: s.utr ? text(s.utr, 40) : null,
  }
}

/** Payment → settlement, from the settlement report's payment lines. */
export function reconLinks(items) {
  const out = []
  for (const it of items || []) {
    if (!it || it.type !== 'payment' || !it.entity_id || !it.settlement_id) continue
    out.push({
      payment_id: text(it.entity_id, 40),
      settlement_id: text(it.settlement_id, 40),
      settled_at: it.settled_at ? new Date(num(it.settled_at) * 1000).toISOString() : null,
    })
  }
  return out
}

async function rzpGetAll(fetchImpl, auth, path, params) {
  const out = []
  for (let skip = 0, page = 0; page < 100; page += 1) {
    const url = new URL(`https://api.razorpay.com/v1/${path}`)
    for (const [k, v] of Object.entries({ ...params, count: '100', skip: String(skip) })) url.searchParams.set(k, v)
    const res = await fetchImpl(url.toString(), { headers: { Authorization: auth } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Razorpay ${path} ${res.status}: ${scrub(body?.error?.description || 'no detail')}`)
    const items = Array.isArray(body.items) ? body.items : []
    out.push(...items)
    if (items.length < 100) break
    skip += items.length
  }
  return out
}

export async function readRazorpay({ fetchImpl = fetch, keyId, keySecret, from, to, nowMs = Date.now() }) {
  if (!keyId || !keySecret) throw new Error('The live Razorpay keys are not set')
  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`
  const window = { from: String(istMidnight(from)), to: String(Math.min(istMidnight(addDays(to, 1)), Math.floor(nowMs / 1000))) }
  const payments = (await rzpGetAll(fetchImpl, auth, 'payments', window)).map(rzpPaymentRow)
  const refunds = (await rzpGetAll(fetchImpl, auth, 'refunds', window)).map(rzpRefundRow)
  const settlements = (await rzpGetAll(fetchImpl, auth, 'settlements', window)).map(rzpSettlementRow)
  const links = []
  for (const day of daysBetween(from, to)) {
    const [year, month, date] = day.split('-')
    const items = await rzpGetAll(fetchImpl, auth, 'settlements/recon/combined', {
      year, month: String(Number(month)), day: String(Number(date)),
    })
    links.push(...reconLinks(items))
  }
  return { payments, refunds, settlements, links }
}
