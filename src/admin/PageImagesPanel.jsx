// The photographs of the SITE'S OWN PAGES — the admin-only surface behind the
// "Page images" section of the dashboard.
//
// The About hero, the Contact banner, the homepage "Our story" picture and
// the two editorial pictures on About used to live only in
// src/data/images.js: changing one meant editing source and redeploying.
// They are now read from the `banners` table under a `slot` of their own
// (src/lib/pageImages.js) and edited here, with the SAME drag control, the
// SAME framing rule and the SAME storage bucket the homepage banners use.
// There is no second image system — a page photograph is a banner for a page
// that shows one instead of a slider.
//
// The homepage reads `slot = 'home_hero'` only (src/lib/banners.js), so
// nothing in here can leak into its slider, and its rows never appear here.
//
// Every slot always HAS a photograph: until a row is saved the page falls
// back to the photo in src/data/images.js, framed by the same numbers
// `PAGE_IMAGES` declares. That is why this panel starts each slot on the
// fallback rather than on an empty box — so the first drag is a change to
// something real, and pressing Save without touching anything writes
// nothing at all.
//
// Nothing here ever re-encodes, crops or replaces a file. A framing is three
// numbers applied with CSS on the way out; the uploaded photograph stays byte
// for byte what it was.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import FrameBox from './FrameBox.jsx'
import { PAGE_IMAGES, PAGE_IMAGE_SLOTS, resetPageImages } from '../lib/pageImages'
import {
  BANNER_POSITION, ZOOM_MAX, ZOOM_MIN,
  bannerPosition, positionColumns, samePosition,
} from '../lib/bannerPosition'
import { bannerImageProblem } from '../lib/bannerLinks'

const bucket = 'product-images'

/** The slots, in the order they are listed here. */
const SLOTS = PAGE_IMAGE_SLOTS

/**
 * What one slot shows: its saved row when there is one, its fallback when
 * there is not — in the same shape either way, so the editor never has to
 * ask which kind it is holding.
 */
const draftFor = (def, row) => ({
  slot: def.slot,
  id: row?.id || null,
  image: (row?.image || def.fallback.image || '').trim(),
  focus_x: row ? row.focus_x : def.fallback.focus_x,
  focus_y: row ? row.focus_y : def.fallback.focus_y,
  zoom: row ? row.zoom : def.fallback.zoom,
})

/** Has this draft moved from what the database holds? */
const sameAsSaved = (draft, saved) =>
  draft.image === saved.image && samePosition(draft, saved)

function ImageRow({ def, draft, saved, busy, uploading, onChange, onUpload }) {
  const fileRef = useRef(null)
  const framing = bannerPosition(draft)
  const problem = bannerImageProblem(draft.image)
  const untouched = sameAsSaved(draft, saved)
  const isDefault = !draft.id && untouched

  const set = (patch) => onChange({ ...draft, ...patch })
  const setFraming = (next) =>
    set({ focus_x: next.x, focus_y: next.y, zoom: next.zoom })

  return (
    <li className="bg-white border border-black/10 rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-black/45 flex flex-wrap items-center gap-2">
            {def.label}
            <span
              className={`rounded-full border px-2 py-[1px] text-[11px] font-medium normal-case tracking-normal ${
                !untouched
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : isDefault
                    ? 'border-black/20 bg-neutral-100 text-black/55'
                    : 'border-green-300 bg-green-50 text-green-800'
              }`}
            >
              {!untouched ? 'Not saved yet' : isDefault ? 'Default photo' : 'Saved'}
            </span>
          </p>
          <p className="text-[13px] text-black/55 mt-1 max-w-[70ch]">{def.note}</p>
        </div>
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
            {uploading ? 'Uploading…' : 'Replace'}
          </button>
          <button
            type="button"
            disabled={busy || uploading || (isDefault && draft.image === def.fallback.image)}
            onClick={() =>
              set({
                image: def.fallback.image,
                focus_x: def.fallback.focus_x,
                focus_y: def.fallback.focus_y,
                zoom: def.fallback.zoom,
              })
            }
            title="Use the photograph the site shipped with again"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium border border-black/30 rounded-lg px-3 h-[38px] text-black/65 hover:border-black transition disabled:opacity-35"
          >
            <RotateCcw size={14} />
            Default
          </button>
        </div>
      </div>

      {problem && <p className="text-[12px] text-red-700 mt-2">{problem}</p>}

      {/* Which part of the photograph each page keeps. The two shapes are the
          frames the page really draws it into — a full-width band is nearly
          twice as wide as it is tall on a desktop and about half as wide on a
          phone — and there is only ONE framing, so both previews always agree.
          Nothing is ever cropped in storage. */}
      <div className="mt-3 flex flex-wrap gap-3 items-start">
        <FrameBox
          src={draft.image}
          label="Desktop"
          framing={framing}
          boxWidth={200}
          ratio={def.desktop}
          onDrag={setFraming}
          onKey={setFraming}
        />
        <FrameBox
          src={draft.image}
          label="Phone"
          framing={framing}
          boxWidth={132}
          ratio={def.phone}
          onDrag={setFraming}
          onKey={setFraming}
        />
        <div className="flex-1 min-w-[150px] space-y-2">
          <label className="block text-[12px] font-semibold uppercase tracking-wider text-black/45" htmlFor={`zoom-${def.slot}`}>
            Zoom
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`zoom-${def.slot}`}
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={framing.zoom}
              disabled={!draft.image}
              onChange={(e) => setFraming({ ...framing, zoom: Number(e.target.value) })}
              className="flex-1 accent-black disabled:opacity-40"
              aria-label={`Zoom for ${def.label}`}
            />
            <span className="text-[12px] text-black/55 tabular-nums w-[38px] text-right">
              {Math.round(framing.zoom * 100)}%
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFraming(BANNER_POSITION)}
            disabled={
              !draft.image ||
              (framing.x === BANNER_POSITION.x &&
                framing.y === BANNER_POSITION.y &&
                framing.zoom === BANNER_POSITION.zoom)
            }
            className="inline-flex items-center gap-1.5 text-[12px] font-medium border border-black/30 rounded-lg px-2.5 h-[30px] text-black/65 hover:border-black transition disabled:opacity-35"
          >
            Centre it
          </button>
          <p className="text-[12px] text-black/45">
            {framing.x === BANNER_POSITION.x && framing.y === BANNER_POSITION.y && framing.zoom === BANNER_POSITION.zoom
              ? 'Centred, as it was uploaded.'
              : `Showing ${Math.round(framing.x)}% across, ${Math.round(framing.y)}% down.`}
          </p>
        </div>
      </div>
    </li>
  )
}

export default function PageImagesPanel({ notify }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState([])
  const [drafts, setDrafts] = useState(() => PAGE_IMAGES.map((d) => draftFor(d, null)))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: readError } = await supabase
        .from('banners')
        .select('*')
        .in('slot', SLOTS)
        .order('created_at', { ascending: true })
      if (readError) throw new Error(readError.message || 'Could not load the page images.')
      const rows = Array.isArray(data) ? data : []
      setSaved(PAGE_IMAGES.map((def) => draftFor(def, rows.find((r) => r.slot === def.slot))))
      setDrafts(PAGE_IMAGES.map((def) => draftFor(def, rows.find((r) => r.slot === def.slot))))
      setError('')
    } catch (e) {
      // A failed read must be REPORTED, never mistaken for "nothing is saved"
      // — otherwise the panel could save a draft over images it never saw.
      setError(e?.message || 'Could not load the page images.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const uploadTo = async (slot, file) => {
    if (!file.type?.startsWith('image/')) throw new Error('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be smaller than 5 MB.')
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg'
    // Unique per upload, and named after its slot, so a page photograph can
    // never overwrite another image.
    const path = `page-image-${slot}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type,
      upsert: false,
    })
    if (upErr) throw upErr
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  }

  const replace = async (index, file) => {
    const slot = PAGE_IMAGES[index].slot
    setUploading(slot)
    try {
      const url = await uploadTo(slot, file)
      setDrafts((rows) => rows.map((r, i) => (i === index ? { ...r, image: url } : r)))
    } catch (e) {
      notify('error', e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading('')
    }
  }

  // Save only what has actually changed. A slot that is exactly as stored is
  // not written at all, and a slot that has never been saved is only inserted
  // when it has really been changed — so pressing Save on an untouched panel
  // creates nothing, and no slot can be duplicated.
  const save = async () => {
    for (let i = 0; i < drafts.length; i += 1) {
      const problem = bannerImageProblem(drafts[i].image)
      if (problem) {
        notify('error', `${PAGE_IMAGES[i].label}: ${problem}`)
        return
      }
    }
    setSaving(true)
    try {
      let written = 0
      for (let i = 0; i < drafts.length; i += 1) {
        const draft = drafts[i]
        if (sameAsSaved(draft, saved[i])) continue
        const payload = {
          image: String(draft.image).trim(),
          // Which part of the photograph the page keeps, and how much it is
          // enlarged. Three numbers, never a rewritten file.
          ...positionColumns(draft),
        }
        if (draft.id) {
          const { error: writeError } = await supabase
            .from('banners')
            .update(payload)
            .eq('id', draft.id)
          if (writeError) throw new Error(writeError.message || 'Nothing was saved — your session may have expired.')
        } else {
          const { error: writeError } = await supabase.from('banners').insert({
            slot: draft.slot,
            position: i,
            is_active: true,
            ...payload,
          })
          if (writeError) throw new Error(writeError.message || 'Nothing was saved — your session may have expired.')
        }
        written += 1
      }
      // The pages read their photograph once per visit; forgetting the read
      // means this tab shows the new photograph as soon as it navigates.
      resetPageImages()
      await load()
      notify(
        'success',
        written
          ? 'Page images saved — the pages show them now.'
          : 'Nothing had changed, so nothing was written.',
      )
    } catch (e) {
      notify('error', e?.message || 'Could not save the page images.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const dirty = drafts.some((d, i) => !sameAsSaved(d, saved[i]))

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Page images</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            The photographs of the shop's own pages — the About hero, the Contact banner, the homepage
            story and the two pictures on About. Drag a preview to choose what its frame keeps.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !dirty}
          className="inline-flex items-center gap-2 h-[46px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save page images'}
        </button>
      </div>

      {error && (
        <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-neutral-200 rounded w-1/3" />
              <div className="h-[160px] bg-neutral-200 rounded-lg mt-4" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-6 space-y-4">
          {PAGE_IMAGES.map((def, i) => (
            <ImageRow
              key={def.slot}
              def={def}
              draft={drafts[i]}
              saved={saved[i]}
              busy={saving}
              uploading={uploading === def.slot}
              onChange={(next) => setDrafts((rows) => rows.map((r, j) => (j === i ? next : r)))}
              onUpload={(file) => replace(i, file)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
