import { useEffect, useRef, useState } from 'react'
import { Loader2, X, Upload, Link2, Trash2, Check } from 'lucide-react'
import useOverlay from '../hooks/useOverlay'
import { supabase } from '../lib/supabase'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[48px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'
const labelCls = 'block text-[13px] font-medium text-black/60'
const bucket = 'product-images'
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']

export const blankProduct = () => ({
  id: '',
  title: '',
  gender: 'men',
  type: 'shirt',
  price: '',
  compare: '',
  badge: '',
  rating: 4.5,
  reviews: 0,
  sizes: ['S', 'M', 'L', 'XL'],
  desc: '',
  image: '',
  hover: '',
  is_active: true,
})

// DB row -> editor form
export const toForm = (p) =>
  p
    ? {
        id: p.id ?? '',
        title: p.title ?? '',
        gender: p.gender ?? 'men',
        type: p.type ?? 'shirt',
        price: p.price ?? '',
        compare: p.compare ?? '',
        badge: p.badge ?? '',
        rating: p.rating ?? 0,
        reviews: p.reviews ?? 0,
        sizes: Array.isArray(p.sizes) ? p.sizes : ['S', 'M', 'L', 'XL'],
        desc: p.desc ?? '',
        image: p.image ?? '',
        hover: p.hover ?? '',
        is_active: p.is_active !== false,
      }
    : blankProduct()

// editor form -> DB payload (mirrors the migration's columns exactly)
export const toPayload = (f) => ({
  id: f.id.trim(),
  title: f.title.trim(),
  gender: f.gender,
  type: f.type,
  price: Math.max(0, Math.round(Number(f.price) || 0)),
  compare: f.compare === '' || f.compare === null ? null : Math.max(0, Math.round(Number(f.compare))),
  rating: Math.min(5, Math.max(0, Number(f.rating) || 0)),
  reviews: Math.max(0, Math.round(Number(f.reviews) || 0)),
  badge: (f.badge || '').trim() || null,
  sizes: f.sizes.length ? f.sizes : ['S', 'M', 'L', 'XL'],
  description: f.desc || '',
  image: (f.image || '').trim() || null,
  hover: (f.hover || '').trim() || null,
  is_active: !!f.is_active,
})

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

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

function ImageField({ name, value, onChange, busy, onPick, note }) {
  const fileRef = useRef(null)
  return (
    <div>
      <span className={labelCls}>{note}</span>
      <div className="mt-2 flex gap-3">
        <div className="w-[72px] h-[88px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
          {value ? (
            <img
              src={value}
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
          <div className="flex gap-2">
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
              {busy ? 'Uploading…' : 'Upload image'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="inline-flex items-center gap-1.5 text-[13px] text-black/50 hover:text-red-600 px-2 h-[38px]"
              >
                <Trash2 size={14} /> Clear
              </button>
            )}
          </div>
          <div className="relative">
            <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
            <input
              type="url"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="…or paste an image URL"
              className={`${inputCls} h-[40px] pl-8 text-[13px]`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProductEditor({ open, isNew, initial, onClose, onSave }) {
  const panel = useRef(null)
  const [form, setForm] = useState(() => toForm(initial))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')

  useOverlay(open, onClose, panel)

  useEffect(() => {
    if (open) {
      setForm(toForm(initial))
      setError('')
      setSaving(false)
    }
  }, [open, initial])

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const upload = async (field, file) => {
    setError('')
    if (!file.type?.startsWith('image/')) return setError('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) return setError('Images must be smaller than 5 MB.')
    setUploading(field)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const base = slug(form.id || form.title) || 'product'
      const path = `${base}-${field}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      set(field)(data.publicUrl)
    } catch (e) {
      setError(e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading('')
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const f = { ...form, id: form.id.trim() || slug(form.title) }
    if (!f.title.trim()) return setError('Please enter a product name.')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(f.id)) return setError('Product ID may only contain lowercase letters, numbers and dashes.')
    if (!(Number(f.price) >= 0)) return setError('Please enter a valid price.')
    setForm(f)
    setSaving(true)
    try {
      await onSave(toPayload(f), isNew, f.id)
    } catch (err) {
      setError(err?.message || 'Could not save this product.')
      setSaving(false)
    }
  }

  if (!open) return null

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
        className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-2xl outline-none flex flex-col"
      >
        <header className="shrink-0 border-b border-black/10 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-[.14em] text-black/40">{isNew ? 'New product' : 'Editing'}</p>
            <h2 className="text-[20px] font-bold truncate">{isNew ? 'Add product' : form.title || 'Untitled'}</h2>
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
                value={form.title}
                onChange={(e) => {
                  set('title')(e.target.value)
                  if (isNew && !form.id) setForm((f) => ({ ...f, title: e.target.value, id: slug(e.target.value) }))
                }}
                placeholder="Men's Caudray Co-Ord Set Black"
                className={`${inputCls} mt-1.5`}
              />
            </label>

            <label className="block">
              <span className={labelCls}>Product ID</span>
              <input
                value={form.id}
                onChange={(e) => set('id')(slug(e.target.value))}
                readOnly={!isNew}
                disabled={!isNew}
                placeholder="men-shirt-1"
                className={`${inputCls} mt-1.5 font-mono text-[14px] disabled:bg-neutral-100 disabled:text-black/45`}
              />
              <span className="block text-[12px] text-black/45 mt-1.5">
                {isNew ? 'Used in the product URL — filled in automatically.' : 'Locked so existing links keep working.'}
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Collection</span>
                <select value={form.gender} onChange={(e) => set('gender')(e.target.value)} className={`${inputCls} mt-1.5`}>
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Category</span>
                <select value={form.type} onChange={(e) => set('type')(e.target.value)} className={`${inputCls} mt-1.5`}>
                  <option value="shirt">Shirts</option>
                  <option value="tshirt">T-shirts</option>
                  <option value="pant">Pants</option>
                </select>
              </label>
            </div>
          </Section>

          <Section title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Price (₹) *</span>
                <input
                  type="number" min="0" step="1" inputMode="numeric"
                  value={form.price}
                  onChange={(e) => set('price')(e.target.value)}
                  placeholder="899"
                  className={`${inputCls} mt-1.5`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Compare-at (₹)</span>
                <input
                  type="number" min="0" step="1" inputMode="numeric"
                  value={form.compare}
                  onChange={(e) => set('compare')(e.target.value)}
                  placeholder="999"
                  className={`${inputCls} mt-1.5`}
                />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>Badge</span>
              <input
                value={form.badge}
                onChange={(e) => set('badge')(e.target.value)}
                placeholder="Bestseller (leave blank for none)"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </Section>

          <Section title="Description">
            <textarea
              value={form.desc}
              onChange={(e) => set('desc')(e.target.value)}
              rows={4}
              placeholder="Soft, breathable fabric with a comfortable everyday fit…"
              className="w-full border border-black/30 rounded-lg px-4 py-3 text-[15px] leading-relaxed bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 resize-y"
            />
          </Section>

          <Section title="Sizes">
            <div className="flex flex-wrap gap-2">
              {SIZE_OPTIONS.map((s) => {
                const on = form.sizes.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set('sizes')(on ? form.sizes.filter((x) => x !== s) : [...form.sizes, s])
                    }
                    className={`min-w-[52px] h-[40px] px-3 rounded-lg border text-[14px] font-medium transition ${
                      on ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/25 hover:border-black/60'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="Images">
            <ImageField
              note="Main image"
              value={form.image}
              onChange={set('image')}
              busy={uploading === 'image'}
              onPick={(f) => upload('image', f)}
            />
            <ImageField
              note="Second image (shown on hover)"
              value={form.hover}
              onChange={set('hover')}
              busy={uploading === 'hover'}
              onPick={(f) => upload('hover', f)}
            />
          </Section>

          <Section title="Ratings">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Rating (0–5)</span>
                <input
                  type="number" min="0" max="5" step="0.1"
                  value={form.rating}
                  onChange={(e) => set('rating')(e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Review count</span>
                <input
                  type="number" min="0" step="1"
                  value={form.reviews}
                  onChange={(e) => set('reviews')(e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </label>
            </div>
          </Section>

          <Section title="Visibility">
            <button
              type="button"
              role="switch"
              aria-checked={form.is_active}
              onClick={() => set('is_active')(!form.is_active)}
              className="w-full flex items-center justify-between gap-4 border border-black/20 rounded-xl px-4 py-3.5 text-left hover:border-black/45 transition"
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{form.is_active ? 'Visible in store' : 'Hidden from store'}</span>
                <span className="block text-[13px] text-black/55">
                  {form.is_active ? 'Shoppers can see and buy this product.' : 'Only admins can see it — it won’t appear anywhere public.'}
                </span>
              </span>
              <span className={`relative w-11 h-6 rounded-full transition shrink-0 ${form.is_active ? 'bg-brand-green' : 'bg-black/25'}`}>
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                    form.is_active ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          </Section>

          {error && (
            <p role="alert" className="text-[14px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
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
