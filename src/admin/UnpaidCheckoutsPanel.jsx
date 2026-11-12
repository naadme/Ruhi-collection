// "Unpaid checkouts": shoppers who typed their mobile number at checkout,
// with what was in the cart, where they came from, and whether a paid order
// followed. The owner can WhatsApp them about that order, or delete a number
// (the way to honour an erasure request; nothing expires on its own).
// Data: public.admin_checkout_leads() and public.checkout_leads, admins only
// (supabase/migrations/20261112200000_checkout_leads.sql).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { inr } from '../lib/pricing'
import { formatShopDateTime } from '../lib/shopTime'
import { cartLines, phoneText, shopperWhatsAppLink, sourceLabel } from './unpaidCheckouts'

export default function UnpaidCheckoutsPanel({ notify }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' })
  const [show, setShow] = useState('unpaid')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const { data, error } = await supabase.rpc('admin_checkout_leads', { p_limit: 300 })
    if (error) setState({ loading: false, rows: [], error: error.message || 'Could not load unpaid checkouts.' })
    else setState({ loading: false, rows: data || [], error: '' })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const unpaid = useMemo(() => state.rows.filter((r) => !r.paid_reference), [state.rows])
  const rows = show === 'unpaid' ? unpaid : state.rows

  // Two taps: the first arms the button, the second deletes.
  const remove = async (phone) => {
    if (armed !== phone) {
      setArmed(phone)
      return
    }
    setBusy(phone)
    const { error } = await supabase.from('checkout_leads').delete().eq('phone', phone)
    setBusy('')
    setArmed('')
    if (error) {
      notify('error', error.message || 'Could not delete this number.')
      return
    }
    setState((s) => ({ ...s, rows: s.rows.filter((r) => r.phone !== phone) }))
    notify('success', `${phoneText(phone)} deleted. It is no longer kept.`)
  }

  const filterBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setShow(key)}
      aria-pressed={show === key}
      className={`px-4 h-10 rounded-lg text-[14px] font-medium transition ${show === key ? 'bg-black text-white' : 'text-black/60 hover:text-black'}`}
    >
      {label}
    </button>
  )

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Unpaid checkouts</h1>
          <p className="text-black/55 mt-2 text-[15px] max-w-[720px]">
            Shoppers who typed their mobile number at checkout. "Didn't pay" means no paid order from that number since
            their last visit. Checkout tells them the number is for order updates only, so message them only about this order.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1">
            {filterBtn('unpaid', `Didn't pay (${unpaid.length})`)}
            {filterBtn('all', `All (${state.rows.length})`)}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={state.loading}
            className="inline-flex items-center gap-2 h-12 px-4 rounded-lg border border-black/20 bg-white text-[14px] font-medium hover:border-black/50 disabled:opacity-60"
          >
            {state.loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh
          </button>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="mt-6 flex items-start gap-2 text-[14px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {state.error}
        </p>
      )}

      {!state.error && !state.loading && rows.length === 0 && (
        <p className="mt-8 text-[15px] text-black/55">
          {show === 'unpaid' ? 'Nobody has left checkout without paying yet.' : 'No numbers recorded yet.'}
        </p>
      )}

      {/* Cards, like the Orders section: they read as well on a phone as on a computer. */}
      {rows.length > 0 && (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.phone} className="bg-white border border-black/10 rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="font-ui text-[17px] font-semibold">{phoneText(r.phone)}</p>
                  <p className="text-[13px] text-black/55 mt-0.5">
                    {formatShopDateTime(r.last_seen_at)}{r.visits > 1 ? ` · ${r.visits} visits` : ''} · {sourceLabel(r)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {r.paid_reference ? (
                    <span className="inline-block rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 text-[12px] font-semibold">
                      Paid · {r.paid_reference}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-0.5 text-[12px] font-semibold">
                      Didn't pay
                    </span>
                  )}
                  <span className="font-ui text-[16px] font-semibold">{inr(r.total)}</span>
                </div>
              </div>
              <ul className="mt-3 space-y-0.5 text-[14px] text-black/80">
                {cartLines(r.items).map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href={shopperWhatsAppLink(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center h-10 px-4 rounded-lg bg-[#0A8040] hover:bg-[#08703A] text-white text-[14px] font-semibold"
                >
                  WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => remove(r.phone)}
                  onBlur={() => setArmed((a) => (a === r.phone ? '' : a))}
                  disabled={busy === r.phone}
                  className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-[14px] font-medium ${
                    armed === r.phone ? 'border-red-600 bg-red-600 text-white' : 'border-black/20 text-black/70 hover:border-red-400 hover:text-red-700'
                  }`}
                >
                  {busy === r.phone ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {armed === r.phone ? 'Tap again to delete' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
