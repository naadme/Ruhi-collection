// Category photographs — the photo half of the dashboard's combined
// "Categories" section (src/admin/CategoriesPanel.jsx, which renders this
// panel under the category manager).
//
// The photographs in the homepage's "Shop by Category" row used to come from
// a hardcoded map in the source code, so the only way to change them was a
// code change and a redeployment. This panel is the missing piece: every
// category, with the picture it shows, an upload button, a choice of the
// photographs that ship with the site, and a save.
//
// It follows the homepage banner panel exactly — the same storage bucket
// (`product-images`), the same upload flow, the same "save" button, the same
// loading and error states — and the chosen picture is written to the
// `categories` row, which only an admin can write (the table's own RLS).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Eye, EyeOff, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useCategories } from '../context/CategoriesContext'
import { useProducts } from '../context/ProductsContext'
import { fetchCategories } from '../lib/categories'
import { CATEGORY_IMAGE_OPTIONS, validateCategoryImage } from '../lib/categoryImages'
import { saveCategoryImage, uploadCategoryImage } from '../lib/categoryImageStore'
import { categoryImage } from '../lib/categoryTiles.js'
import { countByStatus, filterByStatus } from '../lib/statusFilter.js'
import StatusFilter from './StatusFilter.jsx'
import FrameBox from './FrameBox.jsx'
import { BANNER_POSITION, ZOOM_MIN, ZOOM_MAX, bannerPosition } from '../lib/bannerPosition'
import { imageFramingStyle, framingEqual } from '../lib/imageFraming'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'

function CategoryRow({ row, busy, uploading, saved, onUpload, onPick, onClear, onToggle, framing, onFraming }) {
  const fileRef = useRef(null)
  // The picture the homepage shows for this category RIGHT NOW: the owner's
  // own choice when there is one AND it is switched on, and the site's
  // default photograph otherwise. A photograph that is switched off is kept
  // by the category but is not what a visitor sees, so the thumbnail must
  // not show it either — otherwise the panel would promise a picture the
  // site is not showing.
  const active = row.is_active !== false
  const shown = (active && row.image) || row.defaultImage || ''
  const isDefault = shown !== row.image || !row.image
  const frame = bannerPosition(row.framing || {})
  // A photo picked (or uploaded) in this panel is not on the site until the
  // owner presses Save, and the row has to say so rather than look saved.
  const unsaved = !saved
  return (
    <li className={`bg-white border border-black/10 rounded-xl p-4 flex flex-wrap gap-4 items-start ${active ? '' : 'opacity-70'}`}>
      <div className="w-[120px] h-[120px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
        {shown ? (
          <img
            src={shown}
            alt=""
            style={imageFramingStyle(row.framing || {}, shown)}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="text-[11px] text-black/35 text-center px-1">No photograph yet</span>
        )}
        <span className="sr-only">{isDefault ? 'The site’s default photo' : 'The photo you chose'}</span>
      </div>
      <div className="flex-1 min-w-[240px] space-y-2">
        <p className="text-[15px] font-semibold flex items-center gap-2">
          {row.label}
          <span className={`rounded-full border px-2 py-[1px] text-[11px] font-medium ${
            active ? 'border-green-300 bg-green-50 text-green-800' : 'border-black/20 bg-neutral-100 text-black/55'
          }`}>
            {active ? 'Active' : 'Inactive'}
          </span>
          {unsaved && (
            <span className="rounded-full border border-amber-300 bg-amber-50 text-amber-800 px-2 py-[1px] text-[11px] font-medium">
              Not saved yet
            </span>
          )}
        </p>
        <p className="text-[12px] text-black/45 font-mono">{row.key}</p>
        <label className="block">
          <span className="sr-only">Photo for {row.label}</span>
          <select
            value={CATEGORY_IMAGE_OPTIONS.find((o) => o.url === row.image)?.url || ''}
            onChange={(e) => onPick(e.target.value)}
            disabled={busy || uploading}
            className={`${inputCls} h-[40px] text-[13px]`}
          >
            <option value="">Choose one of the site’s photos…</option>
            {CATEGORY_IMAGE_OPTIONS.map((o) => (
              <option key={o.url} value={o.url}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-black/45">
          {row.image
            ? (active
              ? 'Your photo — shown on the homepage and the Collections page.'
              : 'Your photo is switched off — the site shows its default picture until you switch it back on.')
            : 'The site’s default photo — upload one or pick one of the site’s photos to change it.'}
        </p>
      </div>
      {/* Which part of this category’s photograph its frame keeps, drawn with
          the same rule the storefront uses. Categories tile at 4:3 on both
          desktop and phone, so one preview is enough. */}
      {shown && (
        <div className="w-full flex flex-wrap gap-3 items-start pt-1">
          <FrameBox
            src={shown}
            label={row.label}
            framing={frame}
            boxWidth={120}
            ratio="4 / 3"
            onDrag={onFraming}
            onKey={onFraming}
          />
          <div className="flex-1 min-w-[150px] space-y-2">
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-black/45" htmlFor={`zoom-cat-${row.key}`}>
              Zoom
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`zoom-cat-${row.key}`}
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.05}
                value={frame.zoom}
                disabled={!shown}
                onChange={(e) => onFraming({ ...frame, zoom: Number(e.target.value) })}
                className="flex-1 accent-black disabled:opacity-40"
                aria-label={`Zoom for ${row.label}`}
              />
              <span className="text-[12px] text-black/55 tabular-nums w-[38px] text-right">
                {Math.round(frame.zoom * 100)}%
              </span>
            </div>
            <button
              type="button"
              onClick={() => onFraming(BANNER_POSITION)}
              disabled={
                !shown ||
                (frame.x === BANNER_POSITION.x && frame.y === BANNER_POSITION.y && frame.zoom === BANNER_POSITION.zoom)
              }
              className="inline-flex items-center gap-1.5 text-[12px] font-medium border border-black/30 rounded-lg px-2.5 h-[30px] text-black/65 hover:border-black transition disabled:opacity-35"
            >
              Centre it
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onUpload(f)
          }}
        />
        <button
          type="button"
          disabled={busy || uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium border border-black/60 rounded-lg px-3 h-[38px] hover:bg-black hover:text-white transition disabled:opacity-60"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <button
          type="button"
          disabled={busy || uploading}
          onClick={onToggle}
          title={active
            ? 'Switch this photograph off — the site shows its default picture'
            : 'Switch this photograph on — the site shows the photo you chose'}
          aria-label={active ? `Switch the photo for ${row.label} off` : `Switch the photo for ${row.label} on`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          {active ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          type="button"
          disabled={busy || uploading || !row.image}
          onClick={onClear}
          title="Use the site's default photo for this category"
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/50 hover:text-red-600 hover:border-red-300 transition disabled:opacity-35"
        >
          <Trash2 size={15} aria-hidden="true" />
          <span className="sr-only">Use the default photo for {row.label}</span>
        </button>
      </div>
    </li>
  )
}

export default function CategoryImagesPanel({ notify = () => {}, revision = 0 }) {
  const { reload } = useCategories()
  // The storefront's own rule for a category's photograph: the owner's choice
  // first, then the photograph that ships with the site, then the first product
  // photo in that category. The panel asks the SAME rule, so what the owner
  // sees is exactly what a visitor sees — a category with products but no
  // photograph of its own is not shown as an empty box.
  const { products } = useProducts()
  const [rows, setRows] = useState([])
  const [original, setOriginal] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')
  // Which photographs the owner is looking at: all of them, the ones on, or
  // the ones switched off.
  const [status, setStatus] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Strict: a failed read must be reported, never mistaken for "there are
      // no categories" — otherwise a save could write over a list this panel
      // never saw.
      const list = await fetchCategories({ strict: true })
      const withImages = list.map((c) => ({
        key: c.key,
        label: c.label,
        image: String(c.image || ''),
        // Whether the category's own photograph is the one the site shows.
        is_active: c.image_active !== false,
        // Which part of its photograph the site keeps — one framing per
        // photograph, keyed by its address.
        framing: c.image_framing || {},
        // The picture the site shows when the owner has chosen none — the very
        // same rule the storefront uses.
        defaultImage: categoryImage(c, products) || '',
      }))
      setRows(withImages)
      setOriginal(withImages)
      setError('')
    } catch (e) {
      setRows([])
      setOriginal([])
      setError(e?.message || 'Could not load the categories.')
    } finally {
      setLoading(false)
    }
  }, [products])

  // Re-read when the catalogue behind the default photograph changes, and
  // whenever the manager beside this panel saves (a category added, renamed or
  // deleted in the SAME section) — so the owner never has to refresh the page
  // to see the row they just created or named.
  useEffect(() => { load() }, [load, revision])

  const setImage = (key, image) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, image, framing: {} } : r)))

  // A new photograph starts centred: its framing entry belongs to the old
  // address, which no longer exists.
  const setFraming = (key, next) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, framing: next } : r)))

  // Switching a photograph off keeps the photograph and the category: the site
  // simply shows its default picture until it is switched back on.
  const setActive = (key, isActive) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, is_active: isActive } : r)))

  const upload = async (row, file) => {
    setUploading(row.key)
    try {
      const problem = validateCategoryImage(file)
      if (problem) throw new Error(problem)
      const url = await uploadCategoryImage(file)
      setImage(row.key, url)
      notify('success', `Photo uploaded for ${row.label} — press “Save category photos” to publish it.`)
    } catch (e) {
      notify('error', e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading('')
    }
  }

  // What counts as a change: the photograph itself, or whether it is on.
  const changedRows = () => rows.filter((r) => {
    const before = original.find((o) => o.key === r.key)
    // A category that appeared while this panel was open (another admin, or
    // a reload elsewhere) has no "before" to compare against. It is still
    // shown, so it must still be saveable — otherwise the row would look
    // right here and never reach the database.
    if (!before) return Boolean(r.image)
    return r.image !== (before.image || '') || (r.is_active !== false) !== (before.is_active !== false)
      || !framingEqual(before.framing || {}, r.framing || {})
  })
  const dirtyKeys = useMemo(
    () => new Set(changedRows().map((r) => r.key)),
    [rows, original],
  )

  const save = async () => {
    const changed = changedRows()
    if (!changed.length) return
    setSaving(true)
    try {
      for (const row of changed) {
        await saveCategoryImage(row.key, row.image, row.is_active !== false, row.framing)
      }
      // The storefront reads the categories from the database, so a reload
      // here puts the new photos in front of the very next visitor.
      await reload()
      await load()
      notify('success', 'Category photos saved — they are live on the site now.')
    } catch (e) {
      notify('error', e?.message || 'Could not save the category photos.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const dirty = changedRows().length > 0

  // The filter shows a subset of the rows; it never changes the rows
  // themselves, so the order, the photograph and the switch of every category
  // are exactly as they were.
  const counts = useMemo(() => countByStatus(rows), [rows])
  const shown = useMemo(() => filterByStatus(rows, status), [rows, status])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Category photos</h2>
          <p className="text-black/55 mt-2 text-[15px]">
            The photographs in the homepage’s “Shop by Category” row, and on the Collections page. With no photo
            chosen, the site shows its default picture for that category.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !dirty}
          className="inline-flex items-center gap-2 h-[46px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save category photos'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-4 flex items-center gap-4 animate-pulse">
              <div className="w-[120px] h-[120px] rounded-lg bg-neutral-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-neutral-200 rounded w-1/3" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mt-6">
            <StatusFilter value={status} onChange={setStatus} counts={counts} label="Photographs" />
          </div>

          <ul className="mt-4 space-y-3">
            {shown.map((row) => (
              <CategoryRow
                key={row.key}
                row={row}
                busy={saving}
                uploading={uploading === row.key}
                saved={!dirtyKeys.has(row.key)}
                framing={row.framing}
                onUpload={(f) => upload(row, f)}
                onPick={(url) => url && setImage(row.key, url)}
                onClear={() => setImage(row.key, '')}
                onToggle={() => setActive(row.key, row.is_active === false)}
                onFraming={(next) => setFraming(row.key, next)}
              />
            ))}
          </ul>

          {!shown.length && (
            <p className="mt-4 text-[15px] text-black/55">
              {rows.length
                ? 'No photographs in this state — switch the filter to All to see every category.'
                : 'No categories yet — add the first one above.'}
            </p>
          )}
        </>
      )}

      <p className="mt-8 text-[14px] text-black/45">
        Photos are stored in the same secure image storage as product photos and homepage banners. Choosing a
        different photo here never deletes the file it replaces, and switching a photograph off keeps it — the
        category and its products stay exactly as they are.
      </p>
    </div>
  )
}
