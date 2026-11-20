// "Daily numbers": reads what the dashboard shows, as the signed-in owner.
// Every table here is owner-only (row-level security: public.is_admin()).
// Nothing personal is read: no names, phones, emails or addresses.

import { supabase } from '../../lib/supabase'
import { addDays, designOf, istToday } from './dailyMetrics'

const IST = '+05:30'
const PAGE = 1000

/** Every row of a query, a thousand at a time (the API's page size). */
async function all(build) {
  const out = []
  for (let start = 0; start < 50000; start += PAGE) {
    const { data, error } = await build().range(start, start + PAGE - 1)
    if (error) throw new Error(error.message || 'Could not read the dashboard data.')
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message || `Could not read ${name}.`)
  return data || []
}

const ORDER_COLUMNS = [
  'id', 'reference', 'created_at', 'status', 'payment_status', 'payment_method', 'payment_type',
  'total', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbc', 'gclid', 'gbraid', 'wbraid', 'new_customer', 'state', 'experiments', 'razorpay_order_id',
  'order_items(title,qty,unit_price)',
].join(',')

/** GA4 filters the database can apply (dash_ga4_rollup's p_filters). */
export function ga4Filters(filters, adNames) {
  const f = {}
  for (const k of ['channel', 'device', 'browser', 'visitor']) if (filters[k]) f[k] = filters[k]
  if (adNames) f.ads = [...adNames]
  return f
}

/**
 * The rows for the chosen range and, when comparing, the same number of days
 * before it. `adNames` is the ad-name set a campaign / ad set / ad choice
 * stands for (null when none is chosen).
 */
export async function loadPeriod({ range, prev, filters, adNames }) {
  const from = prev ? prev.from : range.from
  const to = range.to
  const gf = ga4Filters(filters, adNames)
  const [test, version] = (filters.ab || ':').split(':')

  const ga4For = (r) => (r ? rpc('dash_ga4_rollup', { p_from: r.from, p_to: r.to, p_filters: gf }) : Promise.resolve([]))
  const abFor = (r) => (r && filters.ab ? rpc('dash_ga4_ab_rollup', { p_from: r.from, p_to: r.to, p_test: test, p_variant: version }) : Promise.resolve([]))
  const itemsFor = (r) => (r && filters.product
    ? rpc('dash_ga4_items_rollup', { p_from: r.from, p_to: r.to, p_item: filters.product }).then((rows) => rows.filter((x) => x.day))
    : Promise.resolve([]))
  const hasFilters = Object.values(filters).some(Boolean)

  const [
    metaDaily, metaSlices, ga4, ga4Prev, ga4Ab, ga4AbPrev, ga4Items, ga4ItemsPrev, itemTotals, ga4Whole,
    orders, leads, attempts, waiting, refunds, settlements, expenses,
  ] = await Promise.all([
    all(() => supabase.from('dash_meta_daily').select('*').gte('day', from).lte('day', to).order('day')),
    all(() => supabase.from('dash_meta_slices').select('*').gte('day', range.from).lte('day', to).order('day')),
    ga4For(range),
    ga4For(prev),
    abFor(range),
    abFor(prev),
    itemsFor(range),
    itemsFor(prev),
    rpc('dash_ga4_items_rollup', { p_from: range.from, p_to: range.to, p_item: null }),
    // The checks compare the whole shop, whatever the filters.
    hasFilters ? rpc('dash_ga4_rollup', { p_from: range.from, p_to: range.to, p_filters: {} }) : Promise.resolve(null),
    all(() => supabase.from('orders').select(ORDER_COLUMNS)
      .gte('created_at', `${from}T00:00:00${IST}`).lt('created_at', `${addDays(to, 1)}T00:00:00${IST}`)
      .or('is_test.is.null,is_test.eq.false').order('created_at')),
    all(() => supabase.from('checkout_leads').select('utm_source,utm_campaign,utm_content,has_meta_click,has_google_click,last_seen_at')
      .gte('last_seen_at', `${from}T00:00:00${IST}`).lt('last_seen_at', `${addDays(to, 1)}T00:00:00${IST}`)),
    all(() => supabase.from('dash_rzp_payments')
      .select('id,rzp_order_id,day,status,method,amount,fee,tax,amount_refunded,captured,error_code,error_reason,error_source,error_step,error_description,settlement_id')
      .gte('day', from).lte('day', to)),
    all(() => supabase.from('dash_rzp_payments').select('id,amount,fee,amount_refunded,settlement_id').eq('captured', true).is('settlement_id', null)),
    all(() => supabase.from('dash_rzp_refunds').select('id,day,amount').gte('day', range.from).lte('day', to)),
    all(() => supabase.from('dash_rzp_settlements').select('*').gte('day', range.from).lte('day', to)),
    all(() => supabase.from('dash_expenses').select('*').lte('starts_on', to).gte('ends_on', from).order('starts_on', { ascending: false })),
  ])

  return {
    metaDaily, metaSlices, ga4, ga4Prev, ga4Ab, ga4AbPrev, ga4Items, ga4ItemsPrev, itemTotals,
    ga4Whole: ga4Whole || ga4,
    orders, leads, attempts, waiting, refunds, settlements, expenses,
  }
}

/** Things that don't change with the range: ads for the filter lists, runs, margin. */
export async function loadSetup() {
  const since = addDays(istToday(), -120)
  const [ads, runs, settings, versions] = await Promise.all([
    all(() => supabase.from('dash_meta_daily').select('ad_id,ad_name,adset_name,campaign_name,day').gte('day', since)),
    rpcLess(() => supabase.from('dash_sync_runs').select('*').order('started_at', { ascending: false }).limit(30)),
    rpcLess(() => supabase.from('dash_settings').select('margin_pct').limit(1)),
    rpc('dash_ab_versions', {}).catch(() => []),
  ])
  return { ads, runs, margin: Number(settings[0]?.margin_pct) || 30, versions: versions.map((v) => v.version) }
}

async function rpcLess(build) {
  const { data, error } = await build()
  if (error) throw new Error(error.message || 'Could not read the dashboard data.')
  return data || []
}

/** Options for the filter lists that come from the shop's own rows. */
export function shopOptions({ orders, itemTotals, attempts }) {
  const states = new Set()
  const products = new Set((itemTotals || []).map((r) => r.item_name))
  const methods = new Set()
  for (const o of orders || []) {
    if (o.state) states.add(o.state)
    if (o.payment_type) methods.add(o.payment_type)
    for (const i of o.order_items || []) products.add(designOf(i.title))
  }
  for (const a of attempts || []) if (a.method) methods.add(a.method)
  const sorted = (s) => [...s].filter(Boolean).sort((a, b) => a.localeCompare(b))
  return { states: sorted(states), products: sorted(products), methods: sorted(methods) }
}

export async function refreshNow() {
  const { data, error } = await supabase.functions.invoke('dashboard-sync', { body: {} })
  if (error) {
    let message = error.message || 'The refresh did not finish.'
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch { /* keep the generic message */ }
    throw new Error(message)
  }
  return data
}

export async function saveMargin(marginPct) {
  const { error } = await supabase.from('dash_settings').update({ margin_pct: marginPct }).eq('id', true)
  if (error) throw new Error(error.message || 'Could not save the margin.')
}

export async function addExpense(row) {
  const { error } = await supabase.from('dash_expenses').insert(row)
  if (error) throw new Error(error.message || 'Could not save this cost.')
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('dash_expenses').delete().eq('id', id)
  if (error) throw new Error(error.message || 'Could not delete this cost.')
}
