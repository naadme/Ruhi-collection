// "Daily numbers" (20 Nov 2026): the owner's view of the whole path to a
// sale, from the ad to the money in the bank, with filters.
//
// Loaded only when the owner opens this section (Dashboard.jsx lazy-loads it),
// with its own stylesheet, so neither the shop nor the rest of the admin
// downloads any of it. Charts are plain SVG: no chart library.
// The sums live in dailyMetrics.js; the reads in dailyData.js; the sync that
// fills the tables in supabase/functions/dashboard-sync.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import './daily.css'
import {
  BROWSERS, CHANNELS, DEVICES, EMPTY_FILTERS, FILTER_LABELS, PRESETS, VISITORS,
  activeFilters, adCatalogue, adNamesFor, adRows, biggestDrop, change, channelRows, checks, dayCount,
  dailyRows, fmtDay, fmtInr, fmtNum, fmtPct, fmtX, funnelRows, istToday, moneySummary, paymentSummary,
  presetRange, previousRange, productRows, sliceRows, periodTotals, addDays,
} from './dailyMetrics'
import { addExpense, deleteExpense, loadPeriod, loadSetup, refreshNow, saveMargin, shopOptions } from './dailyData'

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
function Delta({ value, goodWhenUp = true }) {
  if (value == null || !Number.isFinite(value)) return null
  const up = value > 0
  const flat = Math.abs(value) < 0.005
  // goodWhenUp null: neither direction is good or bad (ad spend).
  const tone = flat || goodWhenUp == null ? '' : up === goodWhenUp ? ' dn-good' : ' dn-bad'
  return <span className={`dn-delta${tone}`}>{flat ? '±0%' : `${up ? '▲' : '▼'} ${Math.abs(value * 100).toFixed(0)}%`}</span>
}

function Tile({ label, value, prev, delta, goodWhenUp, note, strong }) {
  return (
    <div className={`dn-tile${strong ? ' dn-tile-strong' : ''}`}>
      <div className="dn-tile-label">{label}</div>
      <div className="dn-tile-value">{value}</div>
      <div className="dn-tile-sub">
        {delta !== undefined && <Delta value={delta} goodWhenUp={goodWhenUp} />}
        {prev && prev !== '–' && <span className="dn-muted">before: {prev}</span>}
      </div>
      {note && <div className="dn-note">{note}</div>}
    </div>
  )
}

function Card({ title, sub, children, right }) {
  return (
    <section className="dn-card">
      <div className="dn-card-head">
        <div>
          <h2 className="dn-h2">{title}</h2>
          {sub && <p className="dn-sub">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

/** A table that scrolls sideways on a phone. cols: [label, render, {num}] */
function Table({ cols, rows, empty = 'Nothing in this period.', keyOf }) {
  if (!rows.length) return <p className="dn-muted dn-pad">{empty}</p>
  return (
    <div className="dn-scroll">
      <table className="dn-table">
        <thead>
          <tr>{cols.map(([label, , opt]) => <th key={label} scope="col" className={opt?.num ? 'dn-num' : ''}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyOf ? keyOf(r) : i}>
              {cols.map(([label, render, opt]) => <td key={label} className={opt?.num ? 'dn-num' : ''}>{render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Select({ label, value, onChange, options, all = 'All' }) {
  return (
    <label className="dn-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** Spend and revenue per day (or week), as paired bars. */
function SpendRevenueChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.spend || 0, r.revenue || 0)))
  const w = 640
  const h = 160
  const slot = w / Math.max(rows.length, 1)
  const bar = Math.max(2, Math.min(18, slot * 0.36))
  const y = (v) => h - (Math.max(0, v || 0) / max) * (h - 8)
  return (
    <figure className="dn-chart">
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label="Ad spend and revenue by day">
        <line x1="0" x2={w} y1={h} y2={h} className="dn-axis" />
        {rows.map((r, i) => {
          const x = i * slot + slot / 2
          return (
            <g key={r.key}>
              <rect x={x - bar - 1} y={y(r.spend)} width={bar} height={h - y(r.spend)} className="dn-bar-spend"><title>{`${fmtDay(r.key)}: spend ${fmtInr(r.spend)}`}</title></rect>
              <rect x={x + 1} y={y(r.revenue)} width={bar} height={h - y(r.revenue)} className="dn-bar-rev"><title>{`${fmtDay(r.key)}: revenue ${fmtInr(r.revenue)}`}</title></rect>
              {(rows.length <= 10 || i % Math.ceil(rows.length / 8) === 0) && (
                <text x={x} y={h + 14} textAnchor="middle" className="dn-tick">{fmtDay(r.key)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="dn-legend">
        <span><i className="dn-key-spend" /> Ad spend</span>
        <span><i className="dn-key-rev" /> Revenue (paid orders)</span>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Costs typed in by hand, and the margin
// ---------------------------------------------------------------------------
function CostsBox({ expenses, margin, onChanged, notify, range }) {
  const today = istToday()
  const blank = { kind: 'marketing', label: '', amount: '', starts_on: range.from, ends_on: range.to > today ? today : range.to, note: '' }
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState('')
  const [armed, setArmed] = useState('')
  const [pct, setPct] = useState(String(margin))
  useEffect(() => setPct(String(margin)), [margin])

  const add = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.label.trim() || !(amount > 0)) { notify('error', 'Give the cost a name and an amount.'); return }
    if (form.ends_on < form.starts_on) { notify('error', 'The end date is before the start date.'); return }
    setBusy('add')
    try {
      await addExpense({ kind: form.kind, label: form.label.trim(), amount, starts_on: form.starts_on, ends_on: form.ends_on, note: form.note.trim() || null })
      setForm({ ...blank, kind: form.kind })
      notify('success', 'Cost saved.')
      onChanged()
    } catch (err) { notify('error', err.message) } finally { setBusy('') }
  }

  const remove = async (id) => {
    if (armed !== id) { setArmed(id); return }
    setBusy(id)
    try { await deleteExpense(id); notify('success', 'Cost deleted.'); onChanged() } catch (err) { notify('error', err.message) } finally { setBusy(''); setArmed('') }
  }

  const keepMargin = async () => {
    const v = Number(pct)
    if (!(v > 0 && v < 100)) { notify('error', 'The margin is a percentage between 1 and 99.'); return }
    setBusy('margin')
    try { await saveMargin(v); notify('success', `Margin set to ${v}%.`); onChanged() } catch (err) { notify('error', err.message) } finally { setBusy('') }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Card title="Costs and margin" sub="Marketing costs count as ad spend (influencers, Google Ads, a shoot for ads). Other costs only reduce profit (packaging, software). Amounts without GST. A cost over several days is spread evenly over them.">
      <div className="dn-margin">
        <label className="dn-field">
          <span>Profit margin, % of order value</span>
          <input type="number" min="1" max="99" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
        <button type="button" className="dn-btn" onClick={keepMargin} disabled={busy === 'margin' || Number(pct) === margin}>
          {busy === 'margin' ? 'Saving…' : 'Save margin'}
        </button>
        <span className="dn-muted">Break-even return on ad spend at {margin}%: {fmtX(100 / margin)}</span>
      </div>
      <form className="dn-cost-form" onSubmit={add}>
        <label className="dn-field"><span>Type</span>
          <select value={form.kind} onChange={set('kind')}>
            <option value="marketing">Marketing (counts as ad spend)</option>
            <option value="other">Other cost</option>
          </select>
        </label>
        <label className="dn-field"><span>What</span><input value={form.label} onChange={set('label')} maxLength={80} placeholder="e.g. Influencer reel" /></label>
        <label className="dn-field"><span>Amount ₹</span><input type="number" min="1" step="1" value={form.amount} onChange={set('amount')} /></label>
        <label className="dn-field"><span>From</span><input type="date" value={form.starts_on} onChange={set('starts_on')} /></label>
        <label className="dn-field"><span>To</span><input type="date" value={form.ends_on} onChange={set('ends_on')} /></label>
        <label className="dn-field dn-wide"><span>Note (optional)</span><input value={form.note} onChange={set('note')} maxLength={300} /></label>
        <button type="submit" className="dn-btn dn-btn-dark" disabled={busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Add cost'}</button>
      </form>
      <Table
        keyOf={(r) => r.id}
        empty="No costs typed in that touch these dates."
        rows={expenses}
        cols={[
          ['Cost', (r) => <><b>{r.label}</b>{r.note ? <div className="dn-muted">{r.note}</div> : null}</>],
          ['Type', (r) => (r.kind === 'marketing' ? 'Marketing' : 'Other')],
          ['Dates', (r) => (r.starts_on === r.ends_on ? fmtDay(r.starts_on) : `${fmtDay(r.starts_on)} – ${fmtDay(r.ends_on)}`)],
          ['Amount', (r) => fmtInr(Number(r.amount)), { num: true }],
          ['', (r) => (
            <button type="button" className={`dn-link${armed === r.id ? ' dn-danger' : ''}`} onClick={() => remove(r.id)} disabled={busy === r.id} aria-label={`Delete ${r.label}`}>
              <Trash2 size={15} /> {armed === r.id ? 'Tap again to delete' : 'Delete'}
            </button>
          )],
        ]}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------
export default function DailyNumbersPanel({ notify }) {
  const [preset, setPreset] = useState('last7')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [compare, setCompare] = useState(true)
  const [groupBy, setGroupBy] = useState('day')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [setup, setSetup] = useState(null)
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)

  const range = useMemo(() => presetRange(preset, istToday(), custom), [preset, custom])
  const prev = useMemo(() => (compare ? previousRange(range) : null), [compare, range])
  const metaAds = useMemo(() => adCatalogue(setup?.ads || []), [setup])
  const adNames = useMemo(() => adNamesFor(filters, metaAds), [filters, metaAds])

  useEffect(() => {
    let live = true
    loadSetup().then((s) => live && setSetup(s)).catch((e) => live && setState((x) => ({ ...x, error: e.message })))
    return () => { live = false }
  }, [tick])

  useEffect(() => {
    if (!setup) return undefined
    let live = true
    setState((s) => ({ ...s, loading: true }))
    loadPeriod({ range, prev, filters, adNames })
      .then((data) => live && setState({ loading: false, data, error: '' }))
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: e.message })))
    return () => { live = false }
  }, [setup, range, prev, filters, adNames])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const r = await refreshNow()
      const failed = Object.entries(r?.sources || {}).filter(([, s]) => !s.ok).map(([k]) => k)
      notify(failed.length ? 'error' : 'success', failed.length ? `Refreshed, but ${failed.join(', ')} could not be read. See the checks below.` : 'Numbers refreshed.')
    } catch (e) {
      notify('error', e.message)
    } finally {
      setRefreshing(false)
      reload()
    }
  }

  const setFilter = (k) => (v) => setFilters((f) => {
    const next = { ...f, [k]: v }
    if (k === 'campaign') { next.adset = ''; next.ad = '' }
    if (k === 'adset') next.ad = ''
    return next
  })

  const d = state.data
  const margin = setup?.margin ?? 30
  const model = useMemo(() => {
    if (!d) return null
    const base = { metaDaily: d.metaDaily, orders: d.orders, leads: d.leads, attempts: d.attempts, expenses: d.expenses, settlements: d.settlements }
    const now = periodTotals({ data: { ...base, ga4: d.ga4, ga4Ab: d.ga4Ab, ga4Items: d.ga4Items }, filters, range, metaAds, margin })
    const before = prev ? periodTotals({ data: { ...base, ga4: d.ga4Prev, ga4Ab: d.ga4AbPrev, ga4Items: d.ga4ItemsPrev }, filters, range: prev, metaAds, margin }) : null
    const inNow = (a) => a.day >= range.from && a.day <= range.to
    // Every purchase GA4 recorded, including visits the funnel leaves out (abroad, tests).
    const wholeGa4Purchases = d.ga4Whole.filter((r) => (r.part === 'day' || r.part === 'left_out') && r.event_name === 'purchase').reduce((s, r) => s + Number(r.events), 0)
    const last7 = { from: addDays(istToday(), -7), to: addDays(istToday(), -1) }
    return {
      now,
      before,
      funnel: funnelRows(now, before),
      drop: biggestDrop(now, before),
      daily: dailyRows({ data: { ...base, ga4: d.ga4, ga4Ab: d.ga4Ab, ga4Items: d.ga4Items }, filters, range, metaAds, groupBy }),
      ads: adRows({ data: { ...base, ga4: d.ga4 }, filters, range, metaAds }),
      placements: sliceRows(d.metaSlices, 'placement', range),
      ages: sliceRows(d.metaSlices, 'age', range),
      channels: channelRows({ data: { ...base, ga4: d.ga4Whole }, range }),
      products: productRows({ itemTotals: d.itemTotals, orders: d.orders, range }).slice(0, 15),
      payments: paymentSummary(d.attempts.filter(inNow).filter((a) => !filters.payment || a.method === filters.payment)),
      money: moneySummary({ attempts: d.attempts, settlements: d.settlements, allCaptured: d.waiting, range }),
      checks: checks({
        orders: d.orders,
        ga4Purchases: wholeGa4Purchases,
        metaPurchases: d.metaDaily.filter(inNow).reduce((s, r) => s + Number(r.purchases), 0),
        allAttempts: d.attempts,
        metaAccount: setup?.runs?.find((r) => r.info?.meta_account)?.info?.meta_account,
        metaSpendLast7: d.metaDaily.filter((r) => r.day >= last7.from && r.day <= last7.to).reduce((s, r) => s + Number(r.spend), 0),
        runs: setup?.runs || [],
        range,
      }),
      leftOut: d.ga4.filter((r) => r.part === 'left_out' && r.event_name === 'session_start').reduce((s, r) => s + Number(r.events), 0),
      options: shopOptions({ orders: d.orders, itemTotals: d.itemTotals, attempts: d.attempts }),
    }
  }, [d, filters, range, prev, metaAds, margin, groupBy, setup])

  const active = activeFilters(filters)
  const campaigns = [...new Set(metaAds.map((a) => a.campaign_name))].map((n) => [n, n])
  const adsets = [...new Set(metaAds.filter((a) => !filters.campaign || a.campaign_name === filters.campaign).map((a) => a.adset_name))].map((n) => [n, n])
  const adsList = metaAds.filter((a) => (!filters.campaign || a.campaign_name === filters.campaign) && (!filters.adset || a.adset_name === filters.adset)).map((a) => [a.ad_name, a.ad_name])
  const lastRun = setup?.runs?.find((r) => r.finished_at)
  const n = model?.now
  const b = model?.before
  const label = (k, v) => {
    const lists = { channel: CHANNELS, device: DEVICES, browser: BROWSERS, visitor: VISITORS }
    return lists[k]?.find(([x]) => x === v)?.[1] || v
  }
  const days = dayCount(range.from, range.to)

  return (
    <section className="dn-root">
      <div className="dn-head">
        <div>
          <h1 className="dn-h1">Daily numbers</h1>
          <p className="dn-sub">
            From the ad to the bank. Meta spend is without GST. Today's numbers are still coming in, and Meta and GA4 adjust the last few days.
            {lastRun && <> Last updated {new Date(lastRun.finished_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</>}
          </p>
        </div>
        <button type="button" className="dn-btn dn-btn-dark" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 size={16} className="dn-spin" /> : <RefreshCw size={16} />} {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      <div className="dn-bar">
        <label className="dn-field">
          <span>Dates</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="dn-field"><span>From</span><input type="date" value={custom.from || range.from} max={istToday()} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label className="dn-field"><span>To</span><input type="date" value={custom.to || range.to} max={istToday()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
          </>
        )}
        <label className="dn-check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with the {days === 1 ? 'day' : `${days} days`} before</label>
        <button type="button" className="dn-btn" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
          Filters{active.length ? ` (${active.length})` : ''}
        </button>
        <span className="dn-muted dn-range">{fmtDay(range.from)}{range.to !== range.from ? ` – ${fmtDay(range.to)}` : ''}{prev ? ` vs ${fmtDay(prev.from)}${prev.to !== prev.from ? ` – ${fmtDay(prev.to)}` : ''}` : ''}</span>
      </div>

      {showFilters && (
        <div className="dn-filters">
          <Select label="Channel" value={filters.channel} onChange={setFilter('channel')} options={CHANNELS} />
          <Select label="Campaign" value={filters.campaign} onChange={setFilter('campaign')} options={campaigns} />
          <Select label="Ad set" value={filters.adset} onChange={setFilter('adset')} options={adsets} />
          <Select label="Ad" value={filters.ad} onChange={setFilter('ad')} options={adsList} />
          <Select label="Device" value={filters.device} onChange={setFilter('device')} options={DEVICES} />
          <Select label="Browser" value={filters.browser} onChange={setFilter('browser')} options={BROWSERS} />
          <Select label="New / returning" value={filters.visitor} onChange={setFilter('visitor')} options={VISITORS} />
          <Select label="Product" value={filters.product} onChange={setFilter('product')} options={(model?.options.products || []).map((p) => [p, p])} />
          <Select label="State" value={filters.state} onChange={setFilter('state')} options={(model?.options.states || []).map((s) => [s, s])} />
          <Select label="Payment method" value={filters.payment} onChange={setFilter('payment')} options={(model?.options.methods || []).map((m) => [m, m.toUpperCase()])} />
          <Select label="A/B version" value={filters.ab} onChange={setFilter('ab')} options={(setup?.versions || []).map((v) => [v, v.replace(':', ' · version ')])} />
        </div>
      )}
      {active.length > 0 && (
        <div className="dn-chips">
          {active.map((k) => (
            <button key={k} type="button" className="dn-chip" onClick={() => setFilter(k)('')} aria-label={`Remove the ${FILTER_LABELS[k]} filter`}>
              {FILTER_LABELS[k]}: {label(k, filters[k])} <X size={14} />
            </button>
          ))}
          <button type="button" className="dn-link" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</button>
          <span className="dn-muted">A number that can't follow a filter says so instead of showing a wrong figure.</span>
        </div>
      )}

      {state.error && (
        <p className="dn-error" role="alert"><AlertTriangle size={17} /> {state.error}</p>
      )}
      {!model && !state.error && <p className="dn-muted dn-pad"><Loader2 size={16} className="dn-spin" /> Loading…</p>}

      {model && (
        <div className={state.loading ? 'dn-dim' : ''} aria-busy={state.loading}>
          <div className="dn-tiles">
            <Tile label="Ad spend" value={fmtInr(n.adSpend)} delta={b ? change(n.adSpend, b.adSpend) : undefined} goodWhenUp={null} prev={b && fmtInr(b.adSpend)} note={n.notes.adSpend} />
            <Tile label="Revenue (paid orders)" value={fmtInr(n.revenue)} delta={b ? change(n.revenue, b.revenue) : undefined} prev={b && fmtInr(b.revenue)} note={n.notes.revenue} strong />
            <Tile label="Paid orders" value={fmtNum(n.paidOrders)} delta={b ? change(n.paidOrders, b.paidOrders) : undefined} prev={b && fmtNum(b.paidOrders)} note={n.pieces != null ? `${fmtNum(n.pieces)} pieces` : ''} />
            <Tile label="Average order" value={fmtInr(n.aov)} delta={b ? change(n.aov, b.aov) : undefined} prev={b && fmtInr(b.aov)} />
            <Tile
              label="Return on ad spend"
              value={fmtX(n.roas)}
              delta={b ? change(n.roas, b.roas) : undefined}
              prev={b && fmtX(b.roas)}
              note={n.roas == null ? '' : n.roas >= n.breakEvenRoas ? `Above break-even (${fmtX(n.breakEvenRoas)})` : `Below break-even (${fmtX(n.breakEvenRoas)})`}
              strong
            />
            <Tile label="Return, ad orders only" value={fmtX(n.adRoas)} delta={b ? change(n.adRoas, b.adRoas) : undefined} prev={b && fmtX(b.adRoas)} note={n.adPaidOrders != null ? `${n.adPaidOrders} orders tagged as from a Meta ad, ÷ Meta spend` : ''} />
            <Tile label="Ad spend per paid order" value={fmtInr(n.costPerOrder)} delta={b ? change(n.costPerOrder, b.costPerOrder) : undefined} goodWhenUp={false} prev={b && fmtInr(b.costPerOrder)} />
            <Tile label="Profit after ads (estimate)" value={fmtInr(n.profit)} prev={b && fmtInr(b.profit)} note={`${margin}% of revenue − ad spend − other costs. Razorpay fees not included.`} strong />
          </div>

          <Card
            title="The funnel"
            sub="People at each step, the share of the step before, and ad spend per person who reached it. GA4 counts each person once a day. The last four steps come from the shop's orders and Razorpay."
          >
            {model.drop && (
              <p className="dn-callout">
                Biggest drop vs before: <b>{model.drop.label}</b>, {fmtPct(model.drop.rateNow, 0)} of the step before (was {fmtPct(model.drop.rateBefore, 0)}).
              </p>
            )}
            <ol className="dn-funnel">
              {model.funnel.map((s) => {
                const max = Math.max(1, ...model.funnel.filter((x) => x.key !== 'impressions' && x.value != null).map((x) => x.value))
                return (
                  <li key={s.key} className="dn-step">
                    <div className="dn-step-label">{s.label}<span className="dn-src">{s.source === 'meta' ? 'Meta' : s.source === 'ga4' ? 'GA4' : s.source === 'leads' ? 'Shop' : s.key === 'tried' || s.key === 'settled' ? 'Razorpay' : 'Shop'}</span></div>
                    {s.value == null ? (
                      <div className="dn-step-na">{s.na}</div>
                    ) : (
                      <>
                        <div className="dn-step-num">{fmtNum(s.value)}</div>
                        <div className="dn-step-track" aria-hidden="true">{s.key !== 'impressions' && <span style={{ width: `${Math.min(100, (s.value / max) * 100)}%` }} />}</div>
                        <div className="dn-step-meta">
                          {s.ofPrevious != null && <span>{fmtPct(s.ofPrevious, s.ofPrevious < 0.1 ? 1 : 0)} of before</span>}
                          {s.hint && <span>{s.hint}</span>}
                          {s.costEach != null && <span>{fmtInr(s.costEach)} each</span>}
                          <Delta value={s.change} />
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ol>
            {model.leftOut > 0 && <p className="dn-muted dn-pad">Left out: {fmtNum(model.leftOut)} visits from tests (Tag Assistant, Ads Manager previews) or from outside India.</p>}
          </Card>

          <Card
            title={groupBy === 'week' ? 'Week by week' : 'Day by day'}
            right={(
              <div className="dn-toggle" role="group" aria-label="Group by">
                <button type="button" aria-pressed={groupBy === 'day'} onClick={() => setGroupBy('day')}>Days</button>
                <button type="button" aria-pressed={groupBy === 'week'} onClick={() => setGroupBy('week')}>Weeks</button>
              </div>
            )}
          >
            {model.daily.length > 1 && <SpendRevenueChart rows={model.daily} />}
            <Table
              keyOf={(r) => r.key}
              rows={[...model.daily].reverse()}
              cols={[
                [groupBy === 'week' ? 'Week of' : 'Day', (r) => fmtDay(r.key)],
                ['Ad spend', (r) => fmtInr(r.spend), { num: true }],
                ['Visitors', (r) => fmtNum(r.visitors), { num: true }],
                ['Add to cart', (r) => fmtNum(r.atc), { num: true }],
                ['Checkouts', (r) => fmtNum(r.checkouts), { num: true }],
                ['Pay window', (r) => fmtNum(r.orders), { num: true }],
                ['Paid', (r) => fmtNum(r.paid), { num: true }],
                ['Revenue', (r) => fmtInr(r.revenue), { num: true }],
                ['Return', (r) => <span className={r.roas == null ? '' : r.roas >= n.breakEvenRoas ? 'dn-good' : 'dn-bad'}>{fmtX(r.roas)}</span>, { num: true }],
              ]}
            />
          </Card>

          <Card title="Ads" sub="Hook rate: share of people shown the ad who watched 3 seconds. Paid orders and revenue are the shop's own, matched by the ad's name in the link.">
            <Table
              keyOf={(r) => r.ad_id}
              rows={model.ads}
              empty={filters.channel && filters.channel !== 'meta_ads' ? 'No Meta ads in this channel.' : 'No Meta ad ran in this period.'}
              cols={[
                ['Ad', (r) => <><b>{r.ad_name}</b><div className="dn-muted">{r.adset_name}</div></>],
                ['Spend', (r) => fmtInr(r.spend), { num: true }],
                ['Click rate', (r) => fmtPct(r.ctr), { num: true }],
                ['Hook rate', (r) => fmtPct(r.hookRate, 0), { num: true }],
                ['Watched ¼', (r) => fmtPct(r.quarterRate), { num: true }],
                ['Visitors', (r) => fmtNum(r.visitors), { num: true }],
                ['Add to cart', (r) => fmtNum(r.add_to_cart), { num: true }],
                ['Per add to cart', (r) => fmtInr(r.costPerAtc), { num: true }],
                ['Paid', (r) => fmtNum(r.paid), { num: true }],
                ['Revenue', (r) => fmtInr(r.revenue), { num: true }],
                ['Return', (r) => fmtX(r.roas), { num: true }],
              ]}
            />
            <div className="dn-two">
              <div>
                <h3 className="dn-h3">Placements</h3>
                <Table keyOf={(r) => r.slice} rows={model.placements} cols={[
                  ['Where', (r) => r.slice.replace('instagram_', '').replace(/_/g, ' ')],
                  ['Spend', (r) => fmtInr(r.spend), { num: true }],
                  ['Click rate', (r) => fmtPct(r.ctr), { num: true }],
                  ['Add to cart', (r) => fmtNum(r.add_to_cart), { num: true }],
                  ['Per add', (r) => fmtInr(r.costPerAtc), { num: true }],
                  ['Meta sales', (r) => fmtNum(r.purchases), { num: true }],
                ]} />
              </div>
              <div>
                <h3 className="dn-h3">Age groups</h3>
                <Table keyOf={(r) => r.slice} rows={model.ages} cols={[
                  ['Age', (r) => r.slice],
                  ['Spend', (r) => fmtInr(r.spend), { num: true }],
                  ['Click rate', (r) => fmtPct(r.ctr), { num: true }],
                  ['Add to cart', (r) => fmtNum(r.add_to_cart), { num: true }],
                  ['Per add', (r) => fmtInr(r.costPerAtc), { num: true }],
                  ['Meta sales', (r) => fmtNum(r.purchases), { num: true }],
                ]} />
              </div>
            </div>
            {(filters.campaign || filters.adset || filters.ad) && <p className="dn-muted dn-pad">Placements and age groups are for the whole ad account.</p>}
          </Card>

          <Card title="Where visitors came from" sub="GA4, whole shop (not filtered). Paid orders are shown only where the order itself says where it came from.">
            <Table keyOf={(r) => r.key} rows={model.channels} cols={[
              ['Channel', (r) => r.label],
              ['Visitors', (r) => fmtNum(r.visitors), { num: true }],
              ['Viewed a product', (r) => fmtNum(r.viewed), { num: true }],
              ['Add to cart', (r) => fmtNum(r.atc), { num: true }],
              ['Checkouts', (r) => fmtNum(r.checkouts), { num: true }],
              ['Paid orders', (r) => (r.paid == null ? '–' : fmtNum(r.paid)), { num: true }],
            ]} />
          </Card>

          <Card title="Products" sub="Views and add-to-carts from GA4; pieces and value from paid orders. Whole shop.">
            <Table keyOf={(r) => r.name} rows={model.products} cols={[
              ['Product', (r) => r.name],
              ['Views', (r) => fmtNum(r.viewed), { num: true }],
              ['Added to cart', (r) => fmtNum(r.added), { num: true }],
              ['Add rate', (r) => fmtPct(r.addRate), { num: true }],
              ['Pieces paid', (r) => fmtNum(r.pieces), { num: true }],
              ['Value', (r) => fmtInr(r.value), { num: true }],
            ]} />
          </Card>

          <Card title="Payments" sub={`Razorpay payment attempts${filters.payment ? ` by ${filters.payment.toUpperCase()}` : ''}. One order can take several tries.`}>
            <div className="dn-tiles dn-tiles-small">
              <Tile label="Orders that tried to pay" value={fmtNum(model.payments.ordersTried)} />
              <Tile label="…and paid" value={fmtNum(model.payments.ordersPaid)} note={model.payments.ordersTried ? fmtPct(model.payments.ordersPaid / model.payments.ordersTried, 0) : ''} />
              <Tile label="Attempts" value={fmtNum(model.payments.attempts)} />
              <Tile label="Failed attempts" value={fmtNum(model.payments.failed)} />
            </div>
            <div className="dn-two">
              <div>
                <h3 className="dn-h3">By method</h3>
                <Table keyOf={(r) => r.method} rows={model.payments.byMethod} cols={[
                  ['Method', (r) => r.method.toUpperCase()],
                  ['Attempts', (r) => fmtNum(r.attempts), { num: true }],
                  ['Worked', (r) => fmtNum(r.ok), { num: true }],
                  ['Success', (r) => fmtPct(r.ok / r.attempts, 0), { num: true }],
                ]} />
              </div>
              <div>
                <h3 className="dn-h3">Why attempts failed</h3>
                <Table keyOf={(r) => r.reason} rows={model.payments.reasons} empty="No failed attempts." cols={[
                  ['Reason (Razorpay)', (r) => <>{r.reason}{r.step ? <div className="dn-muted">{r.step.replace(/_/g, ' ')}{r.source ? ` · ${r.source}` : ''}</div> : null}</>],
                  ['Times', (r) => fmtNum(r.n), { num: true }],
                ]} />
              </div>
            </div>
          </Card>

          <Card title="Money in" sub="The payments shoppers made on these days, and where that money is now. Razorpay keeps each payment for about 2 working days, then transfers it to your bank. Whole shop.">
            <div className="dn-tiles dn-tiles-small">
              <Tile label="Collected" value={fmtInr(model.money.collected)} note={`Paid by shoppers on these days (${fmtNum(model.money.payments)} payments)`} strong />
              <Tile label="Already in your bank" value={fmtInr(model.money.inBank)} note="Of that, transferred by Razorpay, after fees" />
              <Tile label="Waiting to reach your bank" value={fmtInr(model.money.waiting)} note="Of that, paid by the shopper and held by Razorpay until its next transfer" />
              <Tile label="Razorpay fees" value={fmtInr(model.money.fees)} note={model.money.fees ? `incl. ${fmtInr(model.money.feesGst)} GST` : 'UPI payments carry no fee'} />
              <Tile label="Refunded" value={fmtInr(model.money.refunds)} />
            </div>
            <p className="dn-sub">
              {fmtInr(model.money.collected)} collected = {fmtInr(model.money.inBank)} in your bank + {fmtInr(model.money.waiting)} waiting + {fmtInr(model.money.fees)} fees + {fmtInr(model.money.refunds)} refunded.
              {' '}Right now, from all dates, {fmtInr(model.money.waitingNow)} ({fmtNum(model.money.waitingNowCount)} payments) is waiting to reach your bank.
            </p>
            <h3 className="dn-h3">Razorpay's transfers to your bank on these days: {fmtInr(model.money.transferred)}</h3>
            <p className="dn-muted">A transfer carries payments from about 2 working days before it, so these can include payments from before the first day.</p>
            <Table keyOf={(r) => r.id} rows={model.money.transfers} empty="No transfer on these days." cols={[
              ['Date', (r) => fmtDay(r.day)],
              ['Amount', (r) => fmtInr(Number(r.amount)), { num: true }],
              ['Fees', (r) => fmtInr(Number(r.fees)), { num: true }],
              ['Status', (r) => r.status || ''],
              ['Bank reference', (r) => r.utr || ''],
            ]} />
          </Card>

          <Card title="Checks" sub="Things that need a look, whatever the filters.">
            <ul className="dn-checks">
              {model.checks.map((c) => (
                <li key={c.key} className={c.bad ? 'dn-bad' : 'dn-good'}>
                  <span className="dn-dot" aria-hidden="true" />
                  <b>{c.label}</b>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <CostsBox expenses={d.expenses} margin={margin} onChanged={reload} notify={notify} range={range} />
        </div>
      )}
    </section>
  )
}
