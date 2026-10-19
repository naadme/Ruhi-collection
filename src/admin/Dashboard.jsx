import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Search, Trash2, Loader2, AlertTriangle,
  CheckCircle2, ArrowUpRight, Inbox,
} from 'lucide-react'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import { typeLabelOf } from '../lib/categoryRules'
import { groupRows } from '../lib/productGrouping'
import { colourOf } from '../lib/productForm'
import { createProduct, updateProduct, deleteProduct, setProductActive } from './productApi'
import ProductEditor from './ProductEditor'
import { ProductRow, GroupCard } from './ProductList'
import OrdersPanel from './OrdersPanel'
import BannerPanel from './BannerPanel'
import CouponsPanel from './CouponsPanel'

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

// One dialog for every destructive action, but the copy is built by the
// dashboard so it always names exactly what will happen: deleting a product
// with colours says so, and removing a single colour promises the product
// itself stays.
function Confirm({ title, body, label, busy, onCancel, onConfirm }) {
  const box = useRef(null)
  useEffect(() => {
    if (!title) return
    box.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [title, busy, onCancel])
  if (!title) return null
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
        <h2 id="confirm-title" className="text-[21px] font-bold mt-4">{title}</h2>
        <p className="text-black/60 text-[15px] mt-2 leading-relaxed">{body}</p>
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
            {busy ? 'Working…' : label}
          </button>
        </div>
      </div>
    </div>
  )
}

const TABS = [['all', 'All'], ['live', 'Live'], ['hidden', 'Hidden']]
// Orders, banners and coupons are owner-only surfaces: product managers see
// only the Products tab, exactly as before.
const SECTIONS = [['products', 'Products'], ['orders', 'Orders'], ['banners', 'Banners'], ['coupons', 'Coupons']]

function SectionSwitch({ value, onChange, showOrders }) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1 w-fit"
    >
      {SECTIONS.filter(([k]) => k === 'products' || showOrders).map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          aria-controls={`panel-${k}`}
          onClick={() => onChange(k)}
          className={`px-4 h-10 rounded-lg text-[15px] font-medium transition ${
            value === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard({ showOrders }) {
  const { all, loading, error, source, reload, applyRow, removeRow } = useProducts()
  // The same category list the storefront filters by, so the dashboard's
  // dropdown can never disagree with the shop's Type filter. `typeLabel` is
  // kept: the search box below matches on the displayed category name too.
  const { categories, optionsFor } = useCategories()
  const [section, setSection] = useState('products')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  // `typeLabel` keeps the admin search matching the client's label — a key
  // with no label falls back to itself, as the shop's own search does.
  const typeLabel = useCallback((key) => typeLabelOf(categories, key), [categories])
  const [cat, setCat] = useState('')
  const [openGroups, setOpenGroups] = useState({}) // group key -> expanded?
  const [editing, setEditing] = useState(null) // { isNew, rows, focusKey }
  const [confirm, setConfirm] = useState(null) // { kind: 'product' | 'variant', group, row? }
  const [busyId, setBusyId] = useState('')
  const [toast, setToast] = useState(null)

  const notify = (type, message) => setToast({ type, message, id: Date.now() })

  // One entry per design, grouped with the storefront's own rule, so the
  // dashboard can never show a different grouping than the shop does. Hidden
  // colours take part too — the owner has to see what is hidden.
  const groups = useMemo(() => groupRows(all), [all])
  const takenIds = useMemo(() => all.map((p) => p.id), [all])

  const counts = useMemo(
    () => ({
      all: all.length,
      live: all.filter((p) => p.is_active).length,
      hidden: all.filter((p) => !p.is_active).length,
    }),
    [all],
  )

  // Search, visibility and category filters all run over the parent product:
  // a design matches when its name, category or ANY of its colours or ids do.
  const rows = useMemo(() => {
    const t = query.trim().toLowerCase()
    return groups.filter((g) => {
      if (filter === 'live' && !g.rows.some((r) => r.is_active)) return false
      if (filter === 'hidden' && !g.rows.some((r) => !r.is_active)) return false
      if (cat && g.rows[0].type !== cat) return false
      if (!t) return true
      const hay = [g.name, typeLabel(g.rows[0].type), g.rows[0].type,
        ...g.rows.flatMap((r) => [r.title, r.id, colourOf(r)])]
        .join(' ').toLowerCase()
      return t.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok))
    })
  }, [groups, query, filter, cat])

  // Groups the client is searching through open themselves, so a search lands
  // on the actual colours instead of collapsed cards.
  const expandedFor = (g) => openGroups[g.key] ?? !!query.trim()
  const toggleExpanded = (g) => setOpenGroups((m) => ({ ...m, [g.key]: !expandedFor(g) }))

  const openNew = () => setEditing({ isNew: true, rows: [] })
  const openEdit = (g) => setEditing({ isNew: false, rows: g.rows })
  const openEditVariant = (g, r) => setEditing({ isNew: false, rows: g.rows, focusKey: r.id })

  const handleSave = async (plan) => {
    // Supabase is the source of truth, so every write is awaited, read back
    // and verified before React is told anything. The plan may hold several
    // writes (one per colour); if one fails after others landed, the database
    // — not the editor — is what the panel must show, so it reloads and says
    // exactly how much was saved. With nothing applied yet the editor keeps
    // the client's input and shows why.
    const created = []
    const updated = []
    const deleted = []
    const total = plan.creates.length + plan.updates.length + plan.deletes.length
    try {
      for (const payload of plan.creates) {
        setBusyId(payload.id)
        created.push(await createProduct(payload))
      }
      for (const { id, payload } of plan.updates) {
        setBusyId(id)
        updated.push(await updateProduct(payload))
      }
      for (const id of plan.deletes) {
        setBusyId(id)
        deleted.push(await deleteProduct(id))
      }
    } catch (e) {
      setBusyId('')
      created.forEach(applyRow)
      updated.forEach(applyRow)
      deleted.forEach((row) => removeRow(row.id))
      if (!created.length && !updated.length && !deleted.length) throw e
      setEditing(null)
      await reload()
      notify(
        'error',
        `Saved ${created.length + updated.length + deleted.length} of ${total} changes — the rest failed: ${
          e?.message || 'unknown error'
        }. The list now shows what the store really holds.`,
      )
      return
    }
    setBusyId('')
    created.forEach(applyRow)
    updated.forEach(applyRow)
    deleted.forEach((row) => removeRow(row.id))
    setEditing(null)
    if (!total) {
      notify('success', 'No changes to save.')
      return
    }
    // Re-read the whole catalogue in the background: any other change the
    // owner made meanwhile lands too, and a failed re-read cannot undo the
    // verified rows that are already on screen.
    await reload()
    notify('success', created.length && !updated.length && !deleted.length ? 'Product added to the store.' : 'Product updated.')
  }

  // The exact copy for whichever destructive action is pending, so the client
  // can never mistake "remove one colour" for "delete the whole product".
  const confirmCopy = (c) => {
    if (!c) return {}
    const g = c.group
    if (c.kind === 'variant') {
      const colour = colourOf(c.row) || c.row.title
      return {
        title: `Remove the “${colour}” colour?`,
        body: `Only this colour will be removed from “${g.name}”. The product itself and its other ${
          g.rows.length - 1
        } colour${g.rows.length - 1 === 1 ? '' : 's'} stay in the store.`,
        label: 'Remove colour',
      }
    }
    if (g.rows.length === 1) {
      return {
        title: 'Delete this product?',
        body: `“${g.name}” will be permanently removed from the store. This can’t be undone.`,
        label: 'Delete',
      }
    }
    const colours = g.rows.map((r) => colourOf(r) || r.title).join(', ')
    return {
      title: 'Delete this product and all its colours?',
      body: `“${g.name}” and its ${g.rows.length} colour variants (${colours}) will be permanently removed from the store. This can’t be undone.`,
      label: 'Delete all',
    }
  }

  const handleConfirm = async () => {
    const c = confirm
    if (!c) return
    // Removing one colour never touches the rest of the product.
    if (c.kind === 'variant') {
      const row = c.row
      setBusyId(row.id)
      try {
        await deleteProduct(row.id)
        removeRow(row.id)
        setConfirm(null)
        await reload()
        notify('success', `“${colourOf(row) || row.title}” removed from “${c.group.name}”.`)
      } catch (e) {
        notify('error', e?.message || 'Could not remove this colour.')
      } finally {
        setBusyId('')
      }
      return
    }
    const list = c.group.rows
    setBusyId(list[0].id)
    let done = 0
    try {
      for (const row of list) {
        await deleteProduct(row.id)
        removeRow(row.id)
        done += 1
      }
      setConfirm(null)
      await reload()
      notify('success', `“${c.group.name}” deleted.`)
    } catch (e) {
      setConfirm(null)
      await reload()
      notify(
        'error',
        done
          ? `Deleted ${done} of ${list.length} rows — the rest failed: ${e?.message || 'unknown error'}.`
          : e?.message || 'Could not delete this product.',
      )
    } finally {
      setBusyId('')
    }
  }

  const toggleActive = async (row) => {
    const next = !row.is_active
    setBusyId(row.id)
    try {
      const saved = await setProductActive(row.id, next)
      applyRow(saved)
      await reload()
      notify('success', next ? 'Colour is now visible in the store.' : 'Colour hidden from the store.')
    } catch (e) {
      notify('error', e?.message || 'Could not update visibility.')
    } finally {
      setBusyId('')
    }
  }

  // One switch for a whole design: shows every colour, or hides them all.
  const toggleGroup = async (g) => {
    const target = !g.rows.every((r) => r.is_active)
    setBusyId(g.rows[0].id)
    try {
      for (const r of g.rows) {
        if (r.is_active === target) continue
        applyRow(await setProductActive(r.id, target))
      }
      await reload()
      notify('success', target ? `“${g.name}” is now visible in the store.` : `“${g.name}” hidden from the store.`)
    } catch (e) {
      notify('error', e?.message || 'Could not update visibility.')
      await reload()
    } finally {
      setBusyId('')
    }
  }

  // Orders, banners and coupons live behind their own admin-only sections;
  // returning early here keeps the products panel (and every hook above it)
  // untouched.
  if (showOrders && section !== 'products') {
    return (
      <div className="font-ui">
        <SectionSwitch value={section} onChange={setSection} showOrders={showOrders} />
        <div id={`panel-${section}`} role="tabpanel" className="mt-8">
          {section === 'orders' && <OrdersPanel notify={notify} />}
          {section === 'banners' && <BannerPanel notify={notify} />}
          {section === 'coupons' && <CouponsPanel notify={notify} />}
        </div>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    )
  }

  return (
    <div className="font-ui">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionSwitch value={section} onChange={setSection} showOrders={showOrders} />
      </div>

      <div id="panel-products" role="tabpanel">
        {/* Page head */}
        <div className="flex flex-wrap items-end justify-between gap-4 mt-8">
          <div>
            <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Products</h1>
            <p className="text-black/55 mt-2 text-[15px]">
              {counts.all} {counts.all === 1 ? 'product' : 'products'}
              {groups.length < counts.all ? ` in ${groups.length} designs` : ''} · {counts.live} live · {counts.hidden} hidden
            </p>
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 h-[48px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition"
          >
            <Plus size={18} /> Add product
          </button>
        </div>

        {(error || (!loading && source === 'seed')) && (
          <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span className="min-w-0">
              {source === 'seed'
                ? 'Not talking to Supabase — showing the bundled catalogue, so these rows are not the live store. '
                : 'Could not refresh from Supabase — still showing the last rows the database returned. '}
              {error && <strong>{error}</strong>}
            </span>
          </div>
        )}

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap gap-3 items-center justify-between border-y border-black/10 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3.5 h-9 rounded-lg text-[14px] font-medium transition ${
                    filter === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 text-[12px] ${filter === k ? 'text-white/70' : 'text-black/40'}`}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              aria-label="Filter by category"
              className="h-10 pl-3 pr-4 rounded-lg border border-black/20 bg-white text-[14px] outline-none focus:border-black focus:ring-2 focus:ring-black/10"
            >
              <option value="">All categories</option>
              {optionsFor(cat).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[220px] sm:max-w-[320px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products or colours…"
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
              {all.length === 0 ? 'No products yet' : filter === 'all' && !query && !cat ? 'No products yet' : 'Nothing matches'}
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
            {rows.map((g) =>
              g.rows.length === 1 ? (
                <ProductRow
                  key={g.rows[0].id}
                  p={g.rows[0]}
                  busy={busyId === g.rows[0].id}
                  onToggle={() => toggleActive(g.rows[0])}
                  onEdit={() => openEdit(g)}
                  onDelete={() => setConfirm({ kind: 'product', group: g })}
                />
              ) : (
                <GroupCard
                  key={g.key}
                  g={g}
                  expanded={expandedFor(g)}
                  onExpand={() => toggleExpanded(g)}
                  busyId={busyId}
                  onToggleGroup={() => toggleGroup(g)}
                  onToggleVariant={(r) => toggleActive(r)}
                  onEdit={() => openEdit(g)}
                  onEditVariant={(r) => openEditVariant(g, r)}
                  onAddColour={() => setEditing({ isNew: false, rows: g.rows, addColour: true })}
                  onDeleteGroup={() => setConfirm({ kind: 'product', group: g })}
                  onRemoveVariant={(r) => setConfirm({ kind: 'variant', group: g, row: r })}
                />
              ),
            )}
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
          initial={editing ? { rows: editing.rows || [] } : null}
          focusKey={editing?.focusKey || ''}
          addColour={!!editing?.addColour}
          takenIds={takenIds}
          canManageCategories={showOrders}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />

        <Confirm
          {...confirmCopy(confirm)}
          busy={!!busyId && !!confirm && (confirm.kind === 'variant' ? busyId === confirm.row?.id : confirm.group?.rows.some((r) => r.id === busyId))}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
