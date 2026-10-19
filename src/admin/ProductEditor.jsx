import { useEffect, useRef, useState } from 'react'
import { Loader2, X, Upload, Link2, Trash2, Check, Plus, ArrowLeft, ArrowRight } from 'lucide-react'
import useOverlay from '../hooks/useOverlay'
import { supabase } from '../lib/supabase'
import { TYPES } from '../data/products'
import {
  blankVariant, buildPlan, buildTitle, groupForm, MAX_IMAGES_PER_COLOUR, photosOf, slug,
  SIZE_OPTIONS, toggleSize, validateForm, withIds,
} from '../lib/productForm'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[48px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'
const labelCls = 'block text-[13px] font-medium text-black/60'
const bucket = 'product-images'

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-[.14em] text-black/40 border-b border-black/10 pb-2">
        {title}
      </h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

// One photo slot inside a colour's photo list: preview, replace, remove,
// reorder and a direct-URL field — the same controls the single-image fields
// always had, now per photo.
function PhotoSlot({ index, total, url, busy, onPick, onUrl, onRemove, onMove }) {
  const fileRef = useRef(null)
  const slotLabel =
    index === 0 ? 'Main image (shop card)' : index === 1 ? 'Second image (card hover)' : `Extra photo ${index - 1}`
  return (
    <div className="flex gap-3 border border-black/10 rounded-lg p-3">
      <div className="w-[72px] h-[88px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
        {url ? (
          <img
            src={url}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="text-[10px] text-black/35 text-center px-1">No image</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-[12px] font-medium text-black/60">{slotLabel}</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onPick(f)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium border border-black/60 rounded-lg px-3 h-[38px] hover:bg-black hover:text-white transition disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? 'Uploading…' : 'Replace'}
          </button>
          <button
            type="button"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            aria-label={`Move photo ${index + 1} earlier`}
            className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            aria-label={`Move photo ${index + 1} later`}
            className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 text-[13px] text-black/50 hover:text-red-600 px-2 h-[38px]"
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
        <div className="relative">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            type="url"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="…or paste an image URL"
            aria-label={`Image URL for photo ${index + 1}`}
            className={`${inputCls} h-[40px] pl-8 text-[13px]`}
          />
        </div>
      </div>
    </div>
  )
}

// One colour's whole photo set: up to MAX_IMAGES_PER_COLOUR photos, in display
// order. The first is the shop card image, the second its hover image, and all
// of them appear in the product gallery — for this colour only, because every
// colour is its own database row with its own gallery.
function PhotoList({ photos, uploading, onPick, onUrl, onRemove, onMove, onAdd }) {
  const addRef = useRef(null)
  return (
    <div>
      <span className={labelCls}>Photos (up to {MAX_IMAGES_PER_COLOUR})</span>
      <p className="block text-[12px] text-black/45 mt-1">
        The first photo is the shop card image, the second is its hover image, and all of them appear in the
        product gallery — in this order. Each colour keeps its own photos.
      </p>
      <div className="mt-2 space-y-3">
        {photos.map((url, i) => (
          <PhotoSlot
            key={i}
            index={i}
            total={photos.length}
            url={url}
            busy={uploading === i}
            onPick={(f) => onPick(i, f)}
            onUrl={(u) => onUrl(i, u)}
            onRemove={() => onRemove(i)}
            onMove={onMove}
          />
        ))}
        {photos.length < MAX_IMAGES_PER_COLOUR && (
          <>
            <input
              ref={addRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) onAdd(f)
              }}
            />
            <button
              type="button"
              onClick={() => addRef.current?.click()}
              className="w-full h-[44px] rounded-lg border border-dashed border-black/35 text-[13px] font-medium text-black/60 hover:border-black hover:text-black transition inline-flex items-center justify-center gap-2"
            >
              <Plus size={15} /> Add photo ({photos.length}/{MAX_IMAGES_PER_COLOUR})
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function VisibilitySwitch({ on, onToggle, compact }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`w-full flex items-center justify-between gap-4 border border-black/20 rounded-${
        compact ? 'lg px-3.5 py-2.5' : 'xl px-4 py-3.5'
      } text-left hover:border-black/45 transition`}
    >
      <span className="min-w-0">
        <span className={`block ${compact ? 'text-[14px]' : 'text-[15px]'} font-semibold`}>
          {on ? 'Visible in store' : 'Hidden from store'}
        </span>
        {!compact && (
          <span className="block text-[13px] text-black/55">
            {on ? 'Shoppers can see and buy this colour.' : 'Only admins can see it — it won’t appear anywhere public.'}
          </span>
        )}
      </span>
      <span className={`relative w-11 h-6 rounded-full transition shrink-0 ${on ? 'bg-brand-green' : 'bg-black/25'}`}>
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

// One colour card inside the editor: the free-text colour, its own ID, price,
// photos and visibility. Every colour is edited independently and saved as its
// own `products` row — which is exactly how the storefront groups them.
function ColourCard({ v, index, liveCount, isNewProduct, uploading, onChange, onUpload, onRemove, onUndo }) {
  const label = String(v.colour).trim() || (v.original ? 'Colour' : `Colour ${index + 1}`)
  return (
    <div data-vkey={v.key} data-row={v.original?.id || undefined} className="border border-black/15 rounded-xl overflow-hidden scroll-mt-6">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-neutral-50 border-b border-black/10">
        <p className="font-semibold text-[15px] truncate">
          {label}
          {!v.original && (
            <span className="ml-2 text-[11px] font-bold bg-black/10 text-black/60 px-1.5 py-0.5 rounded-sm align-middle">NEW</span>
          )}
        </p>
        {!v.removed && liveCount > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 text-[13px] text-black/50 hover:text-red-600 shrink-0"
          >
            <Trash2 size={14} /> Remove colour
          </button>
        )}
      </div>

      {v.removed ? (
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-red-700">
            “{label}” will be removed from this product when you save. Everything else stays untouched.
          </p>
          <button
            type="button"
            onClick={onUndo}
            className="text-[13px] font-medium border border-black/40 rounded-lg px-3 h-[34px] hover:bg-black hover:text-white transition"
          >
            Undo
          </button>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          <label className="block">
            <span className={labelCls}>Colour *</span>
            <input
              type="text"
              autoComplete="off"
              value={v.colour}
              onChange={(e) => onChange({ colour: e.target.value })}
              placeholder="Type any colour — Black, Wine Red, Pastel Pink…"
              className={`${inputCls} mt-1.5`}
            />
            <span className="block text-[12px] text-black/45 mt-1.5">
              Type any colour you like — nothing is restricted.
            </span>
          </label>

          <label className="block">
            <span className={labelCls}>Product ID</span>
            <input
              value={v.id}
              onChange={(e) => onChange({ id: slug(e.target.value), idTouched: true })}
              readOnly={!!v.original}
              disabled={!!v.original}
              placeholder="auto-filled from the name and colour"
              className={`${inputCls} mt-1.5 font-mono text-[14px] disabled:bg-neutral-100 disabled:text-black/45`}
            />
            <span className="block text-[12px] text-black/45 mt-1.5">
              {v.original
                ? 'Locked so existing links keep working.'
                : isNewProduct && !String(v.id).trim()
                  ? 'Used in the product URL — filled in automatically.'
                  : 'Used in the product URL — change it only if you know what you’re doing.'}
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Price (₹)</span>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                value={v.price}
                onChange={(e) => onChange({ price: e.target.value })}
                placeholder="900"
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Compare-at (₹)</span>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                value={v.compare}
                onChange={(e) => onChange({ compare: e.target.value })}
                placeholder="999"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>

          <PhotoList
            photos={v.photos}
            uploading={
              uploading && uploading.startsWith(`${v.key}:`)
                ? Number(uploading.slice(v.key.length + 1))
                : null
            }
            onPick={(i, f) => onUpload(v, i, f)}
            onAdd={(f) => onUpload(v, v.photos.length, f)}
            onUrl={(i, url) =>
              onChange({ photos: v.photos.map((p, j) => (j === i ? url : p)) })
            }
            onRemove={(i) => onChange({ photos: v.photos.filter((_, j) => j !== i) })}
            onMove={(i, dir) => {
              const j = i + dir
              if (j < 0 || j >= v.photos.length) return
              const next = [...v.photos]
              ;[next[i], next[j]] = [next[j], next[i]]
              onChange({ photos: next })
            }}
          />

          <VisibilitySwitch
            on={v.is_active}
            compact
            onToggle={() => onChange({ is_active: !v.is_active })}
          />
        </div>
      )}
    </div>
  )
}

// The product editor, now managing a whole product: the shared information a
// design carries (name, category, description, sizes, badge, ratings) plus one
// card per colour. Each colour is its own `products` row with its own ID,
// price, photos and visibility — the exact structure the storefront already
// groups — so nothing here invents a second data model.
export default function ProductEditor({ open, isNew, initial, takenIds = [], focusKey = '', addColour = false, onClose, onSave }) {
  const panel = useRef(null)
  const [form, setForm] = useState(() => groupForm(initial?.rows || [], TYPES[0].key))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')
  const [scrollSel, setScrollSel] = useState('')

  useOverlay(open, onClose, panel)

  // Load the product once, at the moment the editor opens: later re-renders
  // of the dashboard (toasts, spinners) must never wipe what the client typed.
  // Opening from a colour's Edit lands on that colour; "add colour" lands on a
  // freshly appended one.
  useEffect(() => {
    if (!open) return
    const next = groupForm(initial?.rows || [], TYPES[0].key)
    let sel = ''
    if (addColour) {
      const key = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      next.variants = [...next.variants, blankVariant(key)]
      sel = `[data-vkey="${key}"]`
    } else if (focusKey) {
      sel = `[data-row="${focusKey}"]`
    }
    setForm(next)
    setError('')
    setSaving(false)
    setUploading('')
    setScrollSel(sel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !scrollSel) return
    const el = panel.current?.querySelector(scrollSel)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setScrollSel('')
  }, [open, scrollSel])

  // Shared fields: also re-derive the IDs of colours that do not have one yet,
  // exactly as the editor has always derived them while typing.
  const setShared = (patch) =>
    setForm((f) => {
      const shared = { ...f.shared, ...patch }
      return { ...f, shared, variants: withIds(shared, f.variants, takenIds) }
    })

  const setVariant = (key, patch) =>
    setForm((f) => ({
      ...f,
      variants: withIds(
        f.shared,
        f.variants.map((v) =>
          v.key === key
            ? {
                ...v,
                ...patch,
                // Touching a photo rebuilds that colour's gallery from the
                // photos in the editor — the same rule the editor has always
                // used, now over the whole photo list.
                ...('photos' in patch ? { galleryDirty: true } : {}),
              }
            : v,
        ),
        takenIds,
      ),
    }))

  const appendColour = () => {
    const key = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    setForm((f) => ({ ...f, variants: [...f.variants, blankVariant(key)] }))
    setScrollSel(`[data-vkey="${key}"]`)
  }

  // Upload (or replace) ONE photo of a colour at a given position. The path
  // is unique per upload, so a photo added to one colour can never overwrite
  // another colour's photo in the bucket.
  const upload = async (v, index, file) => {
    setError('')
    if (!file.type?.startsWith('image/')) return setError('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) return setError('Images must be smaller than 5 MB.')
    const photos = photosOf(v)
    const at = Math.min(Math.max(0, index), MAX_IMAGES_PER_COLOUR - 1)
    if (index >= MAX_IMAGES_PER_COLOUR) {
      return setError(`A colour may carry up to ${MAX_IMAGES_PER_COLOUR} photos.`)
    }
    setUploading(`${v.key}:${at}`)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const base = slug(v.id || buildTitle(form.shared.name, v.colour)) || 'product'
      const path = `${base}-photo${at + 1}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      while (photos.length <= at) photos.push('')
      photos[at] = data.publicUrl
      setVariant(v.key, { photos })
    } catch (e) {
      setError(e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading('')
    }
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    setError('')
    const shared = { ...form.shared, name: String(form.shared.name).trim() }
    const variants = withIds(shared, form.variants, takenIds)
    setForm((f) => ({ ...f, shared, variants }))

    const errors = validateForm({ shared, variants, takenIds })
    if (errors.length) return setError(errors.join(' '))

    // The lead row is the colour the shared section was read from; the parent
    // fields it changes are measured against that row, so an untouched shared
    // section writes to no row at all.
    const lead = variants.find((v) => v.original)?.original || null
    const plan = buildPlan({ shared, variants, takenIds, lead })
    setSaving(true)
    try {
      await onSave(plan)
    } catch (err) {
      setError(err?.message || 'Could not save this product.')
      setSaving(false)
    }
  }

  if (!open) return null

  const live = form.variants.filter((v) => !v.removed)
  const removals = form.variants.length - live.length

  return (
    <div className="fixed inset-0 z-50 font-ui">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Add product' : 'Edit product'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="absolute right-0 top-0 h-full w-full sm:w-[600px] bg-white shadow-2xl outline-none flex flex-col"
      >
        <header className="shrink-0 border-b border-black/10 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-[.14em] text-black/40">{isNew ? 'New product' : 'Editing'}</p>
            <h2 className="text-[20px] font-bold truncate">
              {form.shared.name || 'Untitled'}
              {live.length > 1 ? <span className="text-black/45 font-medium"> · {live.length} colours</span> : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="w-9 h-9 grid place-items-center rounded-full border border-black/15 hover:bg-black hover:text-white transition shrink-0"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit} noValidate className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
          <Section title="Basics">
            <label className="block">
              <span className={labelCls}>Product name *</span>
              <input
                value={form.shared.name}
                onChange={(e) => setShared({ name: e.target.value })}
                placeholder="Classic Shirt"
                className={`${inputCls} mt-1.5`}
              />
              <span className="block text-[12px] text-black/45 mt-1.5">
                The design name on its own — the colour is added by each colour below, e.g. “Classic Shirt - Black”.
              </span>
            </label>

            <label className="block">
              <span className={labelCls}>Category</span>
              <select value={form.shared.type} onChange={(e) => setShared({ type: e.target.value })} className={`${inputCls} mt-1.5`}>
                {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>

            <label className="block">
              <span className={labelCls}>Badge</span>
              <input
                value={form.shared.badge}
                onChange={(e) => setShared({ badge: e.target.value })}
                placeholder="Bestseller (leave blank for none)"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </Section>

          <Section title={`Colours${live.length > 1 ? ` (${live.length})` : ''}`}>
            {form.variants.map((v, i) => (
              <ColourCard
                key={v.key}
                v={v}
                index={i}
                liveCount={live.length}
                isNewProduct={isNew}
                uploading={uploading}
                onChange={(patch) => setVariant(v.key, patch)}
                onUpload={upload}
                onRemove={() => setVariant(v.key, { removed: true })}
                onUndo={() => setVariant(v.key, { removed: false })}
              />
            ))}
            <button
              type="button"
              onClick={appendColour}
              className="w-full h-[46px] rounded-lg border border-dashed border-black/35 text-[14px] font-medium text-black/60 hover:border-black hover:text-black transition inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Add another colour
            </button>
            <p className="text-[12px] text-black/45">
              Each colour is its own product row: its own price, photos and visibility. On the shop they appear as one
              product with a colour choice.
            </p>
          </Section>

          <Section title="Description">
            <textarea
              value={form.shared.desc}
              onChange={(e) => setShared({ desc: e.target.value })}
              rows={4}
              placeholder="Soft, breathable fabric with a comfortable everyday fit…"
              className="w-full border border-black/30 rounded-lg px-4 py-3 text-[15px] leading-relaxed bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 resize-y"
            />
          </Section>

          <Section title="Sizes">
            <div className="flex flex-wrap gap-2">
              {SIZE_OPTIONS.map((s) => {
                const on = form.shared.sizes.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setShared({ sizes: toggleSize(form.shared.sizes, s) })}
                    className={`min-w-[52px] h-[40px] px-3 rounded-lg border text-[14px] font-medium transition ${
                      on ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/25 hover:border-black/60'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <span className="block text-[12px] text-black/45">
              Applies to every colour of this product. Offer only the sizes this product actually stocks —
              stopping at XL, or going up to 5XL, is your choice per product.
            </span>
          </Section>

          <Section title="Ratings">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Rating (0–5)</span>
                <input
                  type="number" min="0" max="5" step="0.1"
                  value={form.shared.rating}
                  onChange={(e) => setShared({ rating: e.target.value })}
                  className={`${inputCls} mt-1.5`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Review count</span>
                <input
                  type="number" min="0" step="1"
                  value={form.shared.reviews}
                  onChange={(e) => setShared({ reviews: e.target.value })}
                  className={`${inputCls} mt-1.5`}
                />
              </label>
            </div>
            <span className="block text-[12px] text-black/45">Shown on the shop card for every colour.</span>
          </Section>

          {removals > 0 && (
            <p className="text-[14px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              {removals === 1 ? 'One colour' : `${removals} colours`} will be removed when you save. The product itself
              stays in the store.
            </p>
          )}

          {error && (
            <p role="alert" className="text-[14px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 whitespace-pre-line">
              {error}
            </p>
          )}
        </form>

        <footer className="shrink-0 border-t border-black/10 px-6 py-4 flex gap-3 bg-white">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-[48px] rounded-lg border border-black/50 text-[15px] font-medium hover:bg-black/5 transition disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="flex-[2] h-[48px] rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
            {saving ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
          </button>
        </footer>
      </aside>
    </div>
  )
}
