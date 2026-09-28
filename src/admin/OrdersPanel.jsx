import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, Inbox, Loader2, MapPin, Phone, RefreshCw, User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { inr } from '../lib/pricing'

const STATUSES = [
  ['pending', 'Pending'],
  ['confirmed', 'Confirmed'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
]

// The status control is the only place status is shown, so it carries the
// colour itself rather than duplicating it in a separate pill.
const TONE = {
  pending: 'bg-amber-50 border-amber-200 text-amber-800',
  confirmed: 'bg-blue-50 border-blue-200 text-blue-800',
  shipped: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  delivered: 'bg-green-50 border-green-200 text-green-800',
  cancelled: 'bg-red-50 border-red-200 text-red-700',
}

const STATUS_FILTERS = [['all', 'All'], ...STATUSES]

function Row({ order, open, onToggle, onStatus, busy }) {
  const items = order.order_items || []
  return (
    <li className="bg-white border border-black/10 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} details for ${order.reference}`}
          className="w-9 h-9 grid place-items-center rounded-lg border border-black/20 hover:bg-black/5 transition shrink-0"
        >
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="font-semibold text-[15px]">
            <span className="font-mono">{order.reference}</span>
            <span className="text-black/45 font-normal text-[13px] ml-2">
              {new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </p>
          <p className="text-[14px] text-black/60 truncate">
            {order.full_name} · {order.city}, {order.state} {order.pincode}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-bold text-[15px] w-24 text-right">{inr(order.total)}</span>
          <label className="sr-only" htmlFor={`st-${order.id}`}>Status for {order.reference}</label>
          <select
            id={`st-${order.id}`}
            value={order.status}
            disabled={busy}
            onChange={(e) => onStatus(order, e.target.value)}
            className={`h-9 rounded-lg border px-2.5 text-[14px] font-medium outline-none focus:border-black focus:ring-2 focus:ring-black/10 disabled:opacity-60 ${TONE[order.status] || TONE.pending}`}
          >
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      {open && (
        <div className="border-t border-black/10 p-4 sm:p-5 grid md:grid-cols-[1.4fr_1fr] gap-6 bg-[#fcfcfb]">
          <div>
            <h4 className="text-[13px] font-semibold uppercase tracking-wider text-black/45">Items</h4>
            <ul className="mt-3 space-y-2">
              {items.length === 0 && <li className="text-[14px] text-black/50">No line items recorded.</li>}
              {items.map((it) => (
                <li key={it.id} className="flex justify-between gap-4 text-[15px]">
                  <span className="min-w-0 truncate">
                    {it.title}
                    <span className="text-black/45 text-[13px]"> · Size {it.size} · ×{it.qty}</span>
                  </span>
                  <span className="font-ui shrink-0">{inr(it.unit_price * it.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 pt-3 border-t border-black/10 space-y-1.5 text-[14px]">
              <div className="flex justify-between"><dt className="text-black/60">Subtotal</dt><dd className="font-ui">{inr(order.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-black/60">Shipping</dt>
                <dd className="font-ui">{order.shipping === 0 ? 'Free' : inr(order.shipping)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="font-ui">{inr(order.total)}</dd></div>
            </dl>
          </div>

          <div className="space-y-4 text-[15px]">
            <div>
              <h4 className="text-[13px] font-semibold uppercase tracking-wider text-black/45">Customer</h4>
              <p className="mt-2 flex items-start gap-2"><User size={15} className="mt-1 shrink-0 text-black/40" />{order.full_name}</p>
              <p className="mt-1 flex items-start gap-2"><MapPin size={15} className="mt-1 shrink-0 text-black/40" />{order.address}, {order.city}, {order.state} {order.pincode}</p>
              <p className="mt-1 flex items-start gap-2"><Phone size={15} className="mt-1 shrink-0 text-black/40" />{order.phone}</p>
              <p className="mt-1 text-black/70 break-all">{order.email}</p>
            </div>
            <div>
              <h4 className="text-[13px] font-semibold uppercase tracking-wider text-black/45">Payment</h4>
              <p className="mt-2">
                {order.payment_method === 'cod' ? 'Cash on delivery' : order.payment_method}
              </p>
              <p className="mt-1 text-[13px] text-black/50">
                {order.status === 'delivered'
                  ? 'Payment collected on delivery.'
                  : order.status === 'cancelled'
                    ? 'Order cancelled — nothing to collect.'
                    : 'Collect payment from the customer on delivery.'}
              </p>
            </div>
            {order.note && (
              <div>
                <h4 className="text-[13px] font-semibold uppercase tracking-wider text-black/45">Delivery note</h4>
                <p className="mt-2 text-black/70">{order.note}</p>
              </div>
            )}
            {order.user_id && (
              <p className="text-[13px] text-black/45">Placed by a signed-in customer.</p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function OrdersPanel({ notify }) {
  const [state, setState] = useState({ loading: true, orders: [], error: '' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async (silent) => {
    if (!silent) setState((s) => ({ ...s, loading: true }))
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
    if (error) setState({ loading: false, orders: [], error: error.message })
    else setState({ loading: false, orders: data || [], error: '' })
  }, [])

  useEffect(() => { load() }, [load])

  // New orders appear without the owner having to refresh the page.
  useEffect(() => {
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load(true))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const counts = useMemo(() => {
    const c = { all: state.orders.length }
    for (const [k] of STATUSES) c[k] = state.orders.filter((o) => o.status === k).length
    return c
  }, [state.orders])

  const rows = useMemo(() => {
    const t = query.trim().toLowerCase()
    return state.orders.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false
      if (!t) return true
      const hay = [o.reference, o.full_name, o.email, o.phone, o.city, o.state, o.pincode].join(' ').toLowerCase()
      return hay.includes(t)
    })
  }, [state.orders, query, filter])

  const setOrderStatus = async (order, status) => {
    setBusyId(order.id)
    const previous = order.status
    // Optimistic so the dropdown feels instant, reverted if the write fails.
    setState((s) => ({ ...s, orders: s.orders.map((o) => (o.id === order.id ? { ...o, status } : o)) }))
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    if (error) {
      setState((s) => ({ ...s, orders: s.orders.map((o) => (o.id === order.id ? { ...o, status: previous } : o)) }))
      notify('error', 'Could not update this order.')
    } else {
      notify('success', `${order.reference} marked ${status}.`)
    }
    setBusyId('')
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Orders</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            {counts.all} {counts.all === 1 ? 'order' : 'orders'} · {counts.pending} awaiting confirmation ·{' '}
            {counts.cancelled} cancelled
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={state.loading}
          className="inline-flex items-center gap-2 h-[46px] px-4 rounded-lg border border-black/70 text-[15px] font-medium hover:bg-black hover:text-white transition disabled:opacity-60"
        >
          <RefreshCw size={16} className={state.loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {state.error && (
        <div role="alert" className="mt-6 flex items-start gap-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">We couldn't load your orders. <strong>{state.error}</strong></span>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3 items-center justify-between border-y border-black/10 py-4">
        <div className="flex flex-wrap items-center gap-1 bg-white border border-black/15 rounded-lg p-1">
          {STATUS_FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`px-3 h-9 rounded-md text-[14px] font-medium transition ${
                filter === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'
              }`}
            >
              {label}
              <span className={`ml-1.5 text-[12px] ${filter === k ? 'text-white/70' : 'text-black/40'}`}>{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px] sm:max-w-[320px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reference, name, city…"
            aria-label="Search orders"
            className="w-full h-10 px-3 rounded-lg border border-black/20 bg-white text-[14px] outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35"
          />
        </div>
      </div>

      {state.loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-4 flex items-center gap-4 animate-pulse">
              <div className="w-9 h-9 rounded-lg bg-neutral-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-neutral-200 rounded w-1/3" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="mt-10 text-center py-16 border border-dashed border-black/15 rounded-2xl bg-white">
          <Inbox size={34} className="mx-auto text-black/25" strokeWidth={1.4} />
          <p className="text-[18px] font-semibold mt-4">
            {state.orders.length === 0 ? 'No orders yet' : 'Nothing matches'}
          </p>
          <p className="text-black/55 mt-1 text-[15px]">
            {state.orders.length === 0
              ? 'Orders placed at checkout will appear here as soon as a customer checks out.'
              : 'Try a different search or status.'}
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((o) => (
            <Row
              key={o.id}
              order={o}
              open={openId === o.id}
              onToggle={() => setOpenId((cur) => (cur === o.id ? '' : o.id))}
              onStatus={setOrderStatus}
              busy={busyId === o.id}
            />
          ))}
        </ul>
      )}

      <p className="mt-8 text-[14px] text-black/45">
        Order totals and prices are calculated by the database — customers cannot change what they are charged.
      </p>
    </div>
  )
}
