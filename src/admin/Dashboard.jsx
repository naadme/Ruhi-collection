import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Search, Pencil, Trash2, Package, Loader2, AlertTriangle,
  CheckCircle2, ArrowUpRight, Inbox,
} from 'lucide-react'
import { useProducts } from '../context/ProductsContext'
import { supabase } from '../lib/supabase'
import ProductEditor from './ProductEditor'
import OrdersPanel from './OrdersPanel'

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [toast, onClose])
  if (!toast) return null
  const ok = toast.type === 'success'
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100vw-2rem)]"
    >
      <div
        className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg border font-ui text-[15px] ${
          ok ? 'bg-white border-green-200 text-green-800' : 'bg-white border-red-200 text-red-700'
        }`}
      >
        {ok ? <CheckCircle2 size={19} className="shrink-0 mt-0.5" /> : <AlertTriangle size={19} className="shrink-0 mt-0.5" />}
        <span className="min-w-0">{toast.message}</span>
        <button onClick={onClose} aria-label="Dismiss" className="text-black/40 hover:text-black ml-2 shrink-0">×</button>
      </div>
    </div>
  )
}

function ConfirmDelete({ product, busy, onCancel, onConfirm }) {
  const box = useRef(null)
  useEffect(() => {
    if (!product) return
    box.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [product, busy, onCancel])
  if (!product) return null
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center p-4 font-ui">
      <div className="absolute inset-0 bg-black/45" onMouseDown={busy ? undefined : onCancel} aria-hidden="true" />
      <div
        ref={box}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative bg-white rounded-2xl max-w-[440px] w-full p-6 shadow-2xl outline-none"
      >
        <span className="inline-grid place-items-center w-11 h-11 rounded-full bg-red-50 border border-red-100 text-red-600">
          <Trash2 size={20} strokeWidth={1.7} />
        </span>
        <h2 id="confirm-title" className="text-[21px] font-bold mt-4">Delete this product?</h2>
        <p className="text-black/60 text-[15px] mt-2 leading-relaxed">
          <strong className="text-black/85">{product.title}</strong> will be permanently removed from the store.
          This can’t be undone.
        </p>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 h-[46px] rounded-lg border border-black/50 text-[15px] font-medium hover:bg-black/5 transition disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 h-[46px] rounded-lg bg-red-600 text-white text-[15px] font-semibold hover:bg-red-700 transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TABS = [['all', 'All'], ['live', 'Live'], ['hidden', 'Hidden']]
const SECTIONS = [['products', 'Products'], ['orders', 'Orders']]

function SectionSwitch({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1 w-fit"
    >
      {SECTIONS.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          aria-controls={`panel-${k}`}
          onClick={() => onChange(k)}
          className={`px-4 h-10 rounded-md text-[15px] font-medium transition ${
            value === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { all, loading, error, reload } = useProducts()
  const [section, setSection] = useState('products')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null) // { isNew, product }
  const [confirm, setConfirm] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [toast, setToast] = useState(null)

  const notify = (type, message) => setToast({ type, message, id: Date.now() })

  const counts = useMemo(
    () => ({
      all: all.length,
      live: all.filter((p) => p.is_active).length,
      hidden: all.filter((p) => !p.is_active).length,
    }),
    [all],
  )

  const rows = useMemo(() => {
    const t = query.trim().toLowerCase()
    return all.filter((p) => {
      if (filter === 'live' && !p.is_active) return false
      if (filter === 'hidden' && p.is_active) return false
      if (!t) return true
      return p.title.toLowerCase().includes(t) || p.id.toLowerCase().includes(t)
    })
  }, [all, query, filter])

  const openNew = () => setEditing({ isNew: true, product: null })
  const openEdit = (p) => setEditing({ isNew: false, product: p })

  const handleSave = async (payload, isNew) => {
    const { error: err } = isNew
      ? await supabase.from('products').insert(payload)
      : await supabase.from('products').update(payload).eq('id', payload.id)
    if (err) throw err
    await reload()
    setEditing(null)
    notify('success', isNew ? 'Product added to the store.' : 'Product updated.')
  }

  const handleDelete = async (product) => {
    setBusyId(product.id)
    try {
      const { error: err } = await supabase.from('products').delete().eq('id', product.id)
      if (err) throw err
      setConfirm(null)
      await reload()
      notify('success', `“${product.title}” deleted.`)
    } catch (e) {
      notify('error', e?.message || 'Could not delete this product.')
    } finally {
      setBusyId('')
    }
  }

  const toggleActive = async (product) => {
    const next = !product.is_active
    setBusyId(product.id)
    try {
      const { error: err } = await supabase.from('products').update({ is_active: next }).eq('id', product.id)
      if (err) throw err
      await reload()
      notify('success', next ? 'Product is now visible in the store.' : 'Product hidden from the store.')
    } catch (e) {
      notify('error', e?.message || 'Could not update visibility.')
    } finally {
      setBusyId('')
    }
  }

  // Orders live behind their own section; returning early here keeps the
  // products panel (and every hook above it) untouched.
  if (section === 'orders') {
    return (
      <div className="font-ui">
        <SectionSwitch value={section} onChange={setSection} />
        <div id="panel-orders" role="tabpanel" className="mt-8">
          <OrdersPanel notify={notify} />
        </div>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )
  }

  return (
    <div className="font-ui">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionSwitch value={section} onChange={setSection} />
      </div>

      <div id="panel-products" role="tabpanel">
        {/* Page head */}
        <div className="flex flex-wrap items-end justify-between gap-4 mt-8">
          <div>
            <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Products</h1>
            <p className="text-black/55 mt-2 text-[15px]">
              {counts.all} {counts.all === 1 ? 'product' : 'products'} · {counts.live} live · {counts.hidden} hidden
            </p>
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 h-[48px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition"
          >
            <Plus size={18} /> Add product
          </button>
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span className="min-w-0">
              Showing the bundled catalogue — the database couldn’t be reached. <strong>{error}</strong>
            </span>
          </div>
        )}

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap gap-3 items-center justify-between border-y border-black/10 py-4">
          <div className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3.5 h-9 rounded-md text-[14px] font-medium transition ${
                  filter === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'
                }`}
              >
                {label}
                <span className={`ml-1.5 text-[12px] ${filter === k ? 'text-white/70' : 'text-black/40'}`}>{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px] sm:max-w-[320px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              aria-label="Search products"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-black/20 bg-white text-[14px] outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35"
            />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <ul className="mt-6 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="bg-white border border-black/10 rounded-xl p-4 flex items-center gap-4 animate-pulse">
                <div className="w-14 h-16 rounded-lg bg-neutral-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-neutral-200 rounded w-1/2" />
                  <div className="h-3 bg-neutral-200 rounded w-1/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="mt-10 text-center py-16 border border-dashed border-black/15 rounded-2xl bg-white">
            <Inbox size={34} className="mx-auto text-black/25" strokeWidth={1.4} />
            <p className="text-[18px] font-semibold mt-4">
              {all.length === 0 ? 'No products yet' : filter === 'all' && !query ? 'No products yet' : 'Nothing matches'}
            </p>
            <p className="text-black/55 mt-1 text-[15px]">
              {all.length === 0
                ? 'Add your first product to publish it to the storefront.'
                : 'Try a different search or filter.'}
            </p>
            {all.length === 0 && (
              <button
                onClick={openNew}
                className="mt-6 inline-flex items-center gap-2 h-[46px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition"
              >
                <Plus size={18} /> Add product
              </button>
            )}
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {rows.map((p) => (
              <li
                key={p.id}
                className="bg-white border border-black/10 rounded-xl p-3 sm:p-4 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 hover:border-black/25 transition"
              >
                <div className="w-14 h-16 sm:w-16 sm:h-20 rounded-lg overflow-hidden bg-neutral-100 shrink-0">
                  {p.image ? (
                    <img
                      src={p.image}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span className="w-full h-full grid place-items-center text-black/25">
                      <Package size={20} />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-auto">
                  <p className="font-semibold text-[16px] leading-snug truncate">{p.title}</p>
                  <p className="text-[13px] text-black/50 mt-0.5 capitalize">
                    {p.gender} · {p.type.replace('tshirt', 't-shirt')} · <span className="font-mono normal-case">{p.id}</span>
                  </p>
                  <p className="text-[15px] mt-1 font-medium">
                    <span className="text-red-600 font-bold">₹{p.price}</span>
                    {p.compare ? <span className="text-black/40 text-[13px] line-through ml-2">₹{p.compare}</span> : null}
                    {p.badge ? <span className="ml-2 text-[11px] font-bold bg-brand-badge text-white px-1.5 py-0.5 rounded-sm">{p.badge}</span> : null}
                  </p>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
                  <button
                    onClick={() => toggleActive(p)}
                    disabled={busyId === p.id}
                    role="switch"
                    aria-checked={p.is_active}
                    aria-label={p.is_active ? `Hide ${p.title}` : `Show ${p.title}`}
                    title={p.is_active ? 'Live — click to hide' : 'Hidden — click to show'}
                    className={`inline-flex items-center gap-2 h-9 px-3 rounded-full border text-[13px] font-medium transition disabled:opacity-60 ${
                      p.is_active
                        ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                        : 'bg-neutral-100 border-black/15 text-black/50 hover:border-black/40'
                    }`}
                  >
                    {busyId === p.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <span className={`w-2 h-2 rounded-full ${p.is_active ? 'bg-green-600' : 'bg-black/35'}`} />
                    )}
                    {p.is_active ? 'Live' : 'Hidden'}
                  </button>

                  <button
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.title}`}
                    className="w-9 h-9 grid place-items-center rounded-lg border border-black/20 hover:bg-black hover:text-white transition"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setConfirm(p)}
                    aria-label={`Delete ${p.title}`}
                    className="w-9 h-9 grid place-items-center rounded-lg border border-black/20 text-red-600 hover:bg-red-600 hover:text-white hover:border-red-600 transition"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 text-[14px] text-black/45 flex items-center gap-1.5">
          <ArrowUpRight size={15} />
          Changes go live on the storefront immediately.{' '}
          <Link to="/shop" className="underline underline-offset-2 hover:text-black">Preview the store</Link>
        </p>

        <ProductEditor
          open={!!editing}
          isNew={!!editing?.isNew}
          initial={editing?.product}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />

        <ConfirmDelete
          product={confirm}
          busy={!!busyId && busyId === confirm?.id}
          onCancel={() => setConfirm(null)}
          onConfirm={() => handleDelete(confirm)}
        />
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
