// Coupon management — the admin-only surface behind the "Coupons" section
// of the dashboard.
//
// A coupon is a code plus a discount (percent or fixed rupees), with an
// optional minimum subtotal and validity window. Shoppers never browse this
// table: at checkout they validate ONE code through the database RPC
// `public.validate_coupon()`, and `public.create_order()` re-validates and
// re-prices everything before any money is charged (see
// supabase/migrations/20261019120100_coupons_and_order_discounts.sql).

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Plus, Power, Tag, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const CODE_RE = /^[A-Z0-9_-]{2,32}$/
const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'
const labelCls = 'block text-[13px] font-medium text-black/60'

const EMPTY = { code: '', kind: 'percent', value: '', min_subtotal: '0', starts_at: '', ends_at: '' }

/** The plain-English form of a coupon, e.g. "10% off" / "₹200 off". */
export const couponLabel = (c) => (c.kind === 'percent' ? `${c.value}% off` : `₹${c.value} off`)

/** A stored timestamp as the local `datetime-local` input expects it. */
const toInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const windowText = (c) => {
  if (!c.starts_at && !c.ends_at) return 'Always'
  const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '…')
  return `${c.starts_at ? fmt(c.starts_at) : 'Now'} → ${c.ends_at ? fmt(c.ends_at) : 'no end date'}`
}

export default function CouponsPanel({ notify }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' })
  const [form, setForm] = useState(EMPTY)
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyCode, setBusyCode] = useState('')
  const [armed, setArmed] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false })
    if (error) setState({ loading: false, rows: [], error: error.message })
    else setState({ loading: false, rows: data || [], error: '' })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const on = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e?.preventDefault?.()
    const code = form.code.trim().toUpperCase()
    const value = Math.round(Number(form.value))
    const min = Math.max(0, Math.round(Number(form.min_subtotal) || 0))
    if (!CODE_RE.test(code)) {
      return setFormError('Codes may use letters, numbers, dashes and underscores — 2 to 32 characters.')
    }
    if (!Number.isFinite(value) || value < 1) return setFormError('Please enter a discount value.')
    if (form.kind === 'percent' && value > 100) return setFormError('A percentage discount cannot be over 100%.')
    if (form.kind === 'fixed' && value > 1000000) return setFormError('That fixed discount is too large.')
    const starts = form.starts_at ? new Date(form.starts_at).toISOString() : null
    const ends = form.ends_at ? new Date(form.ends_at).toISOString() : null
    if (starts && ends && new Date(starts) >= new Date(ends)) {
      return setFormError('The start date must be before the end date.')
    }
    setFormError('')
    setCreating(true)
    const { error } = await supabase.from('coupons').insert({
      code, kind: form.kind, value, min_subtotal: min, starts_at: starts, ends_at: ends, is_active: true,
    })
    setCreating(false)
    if (error) {
      setFormError(/duplicate|already/i.test(error.message || '') ? `The code “${code}” already exists.` : (error.message || 'Could not create this coupon.'))
      return
    }
    setForm(EMPTY)
    await load()
    notify('success', `Coupon ${code} created.`)
  }

  const toggleActive = async (c) => {
    setBusyCode(c.code)
    const { error } = await supabase.from('coupons').update({ is_active: !c.is_active }).eq('code', c.code)
    setBusyCode('')
    if (error) notify('error', error.message || 'Could not update this coupon.')
    else {
      await load()
      notify('success', `Coupon ${c.code} ${c.is_active ? 'switched off' : 'switched on'}.`)
    }
  }

  const remove = async (c) => {
    if (armed !== c.code) {
      setArmed(c.code)
      return
    }
    setArmed('')
    setBusyCode(c.code)
    const { error } = await supabase.from('coupons').delete().eq('code', c.code)
    setBusyCode('')
    if (error) notify('error', error.message || 'Could not delete this coupon.')
    else {
      await load()
      notify('success', `Coupon ${c.code} deleted.`)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Coupons</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            Discount codes shoppers can apply at checkout. The discount is always computed and re-checked by
            the database before payment.
          </p>
        </div>
      </div>

      {/* Create form */}
      <form onSubmit={create} noValidate className="mt-6 bg-white border border-black/10 rounded-xl p-5">
        <h2 className="text-[16px] font-semibold inline-flex items-center gap-2"><Plus size={16} /> Create a coupon</h2>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block">
            <span className={labelCls}>Code *</span>
            <input
              value={form.code}
              onChange={on('code')}
              placeholder="WELCOME10"
              autoCapitalize="characters"
              className={`${inputCls} mt-1.5 font-mono uppercase`}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Discount type</span>
            <select value={form.kind} onChange={on('kind')} className={`${inputCls} mt-1.5`}>
              <option value="percent">Percentage off (%)</option>
              <option value="fixed">Fixed amount off (₹)</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>{form.kind === 'percent' ? 'Percentage *' : 'Amount (₹) *'}</span>
            <input
              type="number" min="1" step="1" inputMode="numeric"
              value={form.value}
              onChange={on('value')}
              placeholder={form.kind === 'percent' ? '10' : '200'}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Minimum order (₹)</span>
            <input
              type="number" min="0" step="1" inputMode="numeric"
              value={form.min_subtotal}
              onChange={on('min_subtotal')}
              placeholder="0"
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Starts (optional)</span>
            <input type="datetime-local" value={form.starts_at} onChange={on('starts_at')} className={`${inputCls} mt-1.5`} />
          </label>
          <label className="block">
            <span className={labelCls}>Ends (optional)</span>
            <input type="datetime-local" value={form.ends_at} onChange={on('ends_at')} className={`${inputCls} mt-1.5`} />
          </label>
        </div>
        {formError && (
          <p role="alert" className="mt-3 text-[14px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={creating}
          className="mt-4 inline-flex items-center gap-2 h-[44px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {creating ? 'Creating…' : 'Create coupon'}
        </button>
      </form>

      {state.error && (
        <div role="alert" className="mt-6 flex items-start gap-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">We couldn't load your coupons. <strong>{state.error}</strong></span>
        </div>
      )}

      {state.loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-neutral-200 rounded w-1/3" />
            </li>
          ))}
        </ul>
      ) : state.rows.length === 0 ? (
        <div className="mt-8 text-center py-14 border border-dashed border-black/15 rounded-2xl bg-white">
          <Tag size={30} className="mx-auto text-black/25" strokeWidth={1.4} />
          <p className="text-[17px] font-semibold mt-3">No coupons yet</p>
          <p className="text-black/55 mt-1 text-[14px]">Create one above — shoppers can apply it at checkout.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {state.rows.map((c) => (
            <li key={c.code} className={`bg-white border rounded-xl p-4 flex flex-wrap items-center gap-4 ${c.is_active ? 'border-black/10' : 'border-black/10 opacity-60'}`}>
              <span className="inline-grid place-items-center w-10 h-10 rounded-full bg-[#F8EDE6] text-[#4A2C23] shrink-0">
                <Tag size={17} strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1 basis-[16rem]">
                <p className="font-mono font-semibold text-[16px]">
                  {c.code}
                  {!c.is_active && <span className="ml-2 align-middle text-[11px] font-bold bg-black/10 text-black/60 px-1.5 py-0.5 rounded-sm font-ui">OFF</span>}
                </p>
                <p className="text-[14px] text-black/60">
                  {couponLabel(c)}
                  {c.min_subtotal > 0 ? ` · minimum order ₹${c.min_subtotal.toLocaleString('en-IN')}` : ''} · {windowText(c)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleActive(c)}
                  disabled={busyCode === c.code}
                  title={c.is_active ? 'Switch this coupon off' : 'Switch this coupon on'}
                  className={`inline-flex items-center gap-1.5 text-[13px] font-medium border rounded-lg px-3 h-[38px] transition disabled:opacity-60 ${
                    c.is_active ? 'border-black/40 text-black/70 hover:border-black' : 'border-green-600 text-green-700 hover:bg-green-50'
                  }`}
                >
                  {busyCode === c.code ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                  {c.is_active ? 'Active' : 'Switch on'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={busyCode === c.code}
                  className={`inline-flex items-center gap-1.5 text-[13px] font-medium border rounded-lg px-3 h-[38px] transition disabled:opacity-60 ${
                    armed === c.code ? 'border-red-600 bg-red-600 text-white' : 'border-black/25 text-black/50 hover:text-red-600 hover:border-red-300'
                  }`}
                >
                  <Trash2 size={14} />
                  {armed === c.code ? 'Click again to delete' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-[14px] text-black/45">
        The price a customer actually pays is always recomputed by the database from the items in their cart
        and the coupon stored on the order — a browser can never set its own discount.
      </p>
    </div>
  )
}
