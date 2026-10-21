// Homepage hero banner management — the admin-only surface behind the
// "Banners" section of the dashboard.
//
// The saved rows drive the homepage hero's photo slider
// (src/components/Sections.jsx). Images are uploaded with the SAME storage
// bucket and upload flow the product editor uses (`product-images`), and the
// rows themselves live in the `banners` table, writable only by admins
// through RLS. Nothing here changes the hero's layout, styling or animation
// — only which photos it slides between.
//
// Each banner carries its OWN destination — a product page, a category page,
// a page of the shop or an approved https:// address — and its own on/off
// switch. The rules for a destination live in src/lib/bannerLinks.js, the same
// module the storefront follows, so a banner can never send a shopper
// somewhere that does not exist.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronUp, Eye, EyeOff, Link2, Loader2, Plus, Trash2, Upload,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchHomeBanners, HOME_HERO_SLOT } from '../lib/banners'
import { useCategories } from '../context/CategoriesContext'
import { useProducts } from '../context/ProductsContext'
import {
  bannerDestinations, bannerImageProblem, bannerLinkProblem, describeBannerDestination,
} from '../lib/bannerLinks.js'
import { countByStatus, filterByStatus } from '../lib/statusFilter.js'
import StatusFilter from './StatusFilter.jsx'

const bucket = 'product-images'
const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'

function BannerRow({ row, index, total, busy, uploading, canReorder, destinations = [], onUrl, onLink, onToggle, onMove, onRemove, onUpload }) {
  const fileRef = useRef(null)
  const problem = bannerLinkProblem(row.link)
  // A photograph typed or pasted by hand is checked the same way its
  // destination is: a typo used to save happily and then show a grey box to
  // every visitor, with nothing here saying so.
  const imageProblem = bannerImageProblem(row.image)
  const active = row.is_active !== false
  // While a filter is on, the list is a subset of the real order, so the
  // arrows would move a banner past one the owner cannot see. They are
  // switched off rather than made to act on the wrong row.
  const reorderable = canReorder !== false
  return (
    <li className={`bg-white border border-black/10 rounded-xl p-4 flex flex-wrap gap-4 items-start ${active ? '' : 'opacity-70'}`}>
      <div className="w-[120px] h-[80px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
        {row.image ? (
          <img
            src={row.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="text-[11px] text-black/35 text-center px-1">No image</span>
        )}
      </div>
      <div className="flex-1 min-w-[220px] space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-black/45 flex items-center gap-2">
          Banner {index + 1}
          <span className={`rounded-full border px-2 py-[1px] text-[11px] font-medium normal-case tracking-normal ${
            active ? 'border-green-300 bg-green-50 text-green-800' : 'border-black/20 bg-neutral-100 text-black/55'
          }`}>
            {active ? 'Live on the site' : 'Hidden'}
          </span>
        </p>
        <div className="relative">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            type="url"
            value={row.image}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="Image URL (or upload a photo)"
            aria-label={`Image URL for banner ${index + 1}`}
            aria-invalid={imageProblem ? 'true' : undefined}
            className={`${inputCls} h-[40px] pl-8 text-[13px] ${imageProblem ? 'border-red-400' : ''}`}
          />
        </div>
        {imageProblem && <p className="text-[12px] text-red-700 -mt-2">{imageProblem}</p>}
        <div className="relative">
          <input
            type="text"
            value={row.link}
            onChange={(e) => onLink(e.target.value)}
            placeholder="Destination — where this banner takes shoppers (e.g. /shop?type=dress)"
            aria-label={`Destination for banner ${index + 1}`}
            aria-invalid={problem ? 'true' : undefined}
            className={`${inputCls} h-[40px] text-[13px] ${problem ? 'border-red-400' : ''}`}
          />
        </div>
        {/* The same list of destinations, offered per banner and showing the
            one this banner already has — so the owner can see where each
            banner goes without reading paths, and change any one of them
            without the choice being applied to whichever row happens to be
            first. Anything typed by hand still stands. */}
        {destinations.length > 0 && (
          <select
            value={destinations.some((d) => d.value === row.link) ? row.link : ''}
            onChange={(e) => e.target.value && onLink(e.target.value)}
            aria-label={`Choose a destination for banner ${index + 1}`}
            className={`${inputCls} h-[40px] text-[13px]`}
          >
            <option value="">Choose a page, a category or a product…</option>
            {destinations.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        )}
        <p className={`text-[12px] ${problem ? 'text-red-700' : 'text-black/45'}`}>
          {problem || describeBannerDestination(row.link)}
        </p>
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
          onClick={onToggle}
          disabled={busy}
          title={active ? 'Hide this banner from the homepage' : 'Show this banner on the homepage'}
          aria-label={active ? `Hide banner ${index + 1}` : `Show banner ${index + 1}`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          {active ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0 || busy || !reorderable}
          title={reorderable ? 'Move this banner earlier' : 'Switch the filter to All to reorder the banners'}
          aria-label={`Move banner ${index + 1} up`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1 || busy || !reorderable}
          title={reorderable ? 'Move this banner later' : 'Switch the filter to All to reorder the banners'}
          aria-label={`Move banner ${index + 1} down`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove banner ${index + 1}`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/50 hover:text-red-600 hover:border-red-300 transition disabled:opacity-35"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  )
}

export default function BannerPanel({ notify }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' })
  const [original, setOriginal] = useState([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(-1)
  // Which banners the owner is looking at: all of them, the ones on the
  // homepage, or the ones switched off.
  const [status, setStatus] = useState('all')
  const addRef = useRef(null)
  const { categories } = useCategories()
  const { products } = useProducts()

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const rows = await fetchHomeBanners({ strict: true })
      setState({ loading: false, rows: rows.map((b) => ({ ...b, link: b.link || '' })), error: '' })
      setOriginal(rows)
    } catch (e) {
      // A failed read must be REPORTED, never mistaken for "no banners yet" —
      // otherwise the admin could save a draft over banners this panel never
      // saw. The homepage keeps its own never-throwing read.
      setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load the homepage banners.' }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setRows = (fn) => setState((s) => ({ ...s, rows: fn(s.rows) }))

  const uploadTo = async (file) => {
    if (!file.type?.startsWith('image/')) throw new Error('Please choose an image file.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be smaller than 5 MB.')
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    // Unique per upload so a banner can never overwrite another image.
    const path = `home-banner-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type,
      upsert: false,
    })
    if (upErr) throw upErr
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  }

  const replaceAt = async (index, file) => {
    setUploading(index)
    try {
      const url = await uploadTo(file)
      setRows((rows) => rows.map((r, i) => (i === index ? { ...r, image: url } : r)))
    } catch (e) {
      notify('error', e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(-1)
    }
  }

  const addBanner = async (file) => {
    setUploading(-2)
    try {
      const url = await uploadTo(file)
      setRows((rows) => [...rows, { id: null, image: url, link: '', is_active: true }])
      notify('success', 'Photo added below — press “Save banners” to publish it.')
    } catch (e) {
      notify('error', e?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(-1)
    }
  }

  const removeAt = (index) => setRows((rows) => rows.filter((_, i) => i !== index))

  const move = (index, dir) =>
    setRows((rows) => {
      const j = index + dir
      if (j < 0 || j >= rows.length) return rows
      const next = [...rows]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })

  // The destinations the owner can pick, offered as a menu: the shop's own
  // pages, every category, and every product. Each banner picks its own.
  const destinations = useMemo(
    () => bannerDestinations(categories, products),
    [categories, products],
  )

  // Publish the draft: kept ones are re-ordered and updated, new ones
  // inserted, and only then are the removed banners deleted.
  //
  // The order matters. A delete that lands before the writes is a banner
  // lost for good if a later write fails; written first, a mid-save failure
  // leaves the store showing the OLD banners (some of them twice at worst),
  // which a reload puts right — nothing the owner chose is thrown away
  // before the replacements are safely in.
  const save = async () => {
    const rows = state.rows
    const empty = rows.some((r) => !String(r.image || '').trim())
    if (empty) {
      notify('error', 'Every banner needs an image — remove the empty entry or upload a photo.')
      return
    }
    const badImage = rows.find((r) => bannerImageProblem(r.image))
    if (badImage) {
      notify('error', `One banner’s photograph cannot be used: ${bannerImageProblem(badImage.image)}`)
      return
    }
    const broken = rows.find((r) => bannerLinkProblem(r.link))
    if (broken) {
      notify('error', `The destination of one banner cannot be used: ${bannerLinkProblem(broken.link)}`)
      return
    }
    setSaving(true)
    try {
      const saved = []
      for (let i = 0; i < rows.length; i += 1) {
        const payload = {
          slot: HOME_HERO_SLOT,
          image: String(rows[i].image).trim(),
          link: String(rows[i].link || '').trim() || null,
          position: i,
          is_active: rows[i].is_active !== false,
        }
        if (rows[i].id) {
          const { data, error } = await supabase
            .from('banners').update(payload).eq('id', rows[i].id).select('id, image, link, position, is_active').single()
          if (error || !data?.id) throw new Error(error?.message || 'Nothing was saved — your session may have expired.')
          saved.push(data.id)
        } else {
          const { data, error } = await supabase.from('banners').insert(payload).select('id, image, link, position, is_active').single()
          if (error || !data?.id) throw new Error(error?.message || 'Nothing was saved — your session may have expired.')
          saved.push(data.id)
        }
      }
      // Everything the draft holds is in the database; only now is anything
      // removed, and only the rows this draft no longer keeps.
      const keep = new Set(saved)
      for (const b of original) {
        if (keep.has(b.id)) continue
        const { error } = await supabase.from('banners').delete().eq('id', b.id)
        if (error) throw new Error(error.message || 'Could not remove a banner.')
      }
      await load()
      notify('success', rows.length ? 'Homepage banner saved — it is live on the site now.' : 'Homepage banner cleared — the site shows its default photos again.')
    } catch (e) {
      notify('error', e?.message || 'Could not save the banner.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    state.rows.length !== original.length ||
    state.rows.some((r, i) => r.image !== (original[i]?.image || '')
      || String(r.link || '') !== (original[i]?.link || '')
      || (r.is_active !== false) !== (original[i]?.is_active !== false))

  // The banners the site is showing right now, in the order it shows them.
  const live = state.rows.filter((r) => r.is_active !== false)

  // The filter shows a subset of the banners; it never changes them. The
  // order, the photograph and the destination of every banner are exactly as
  // they were, and a banner keeps its place in that order whether it is
  // switched on or off.
  const counts = useMemo(() => countByStatus(state.rows), [state.rows])
  const shown = useMemo(() => filterByStatus(state.rows, status), [state.rows, status])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Homepage banner</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            The photos in the slider on the right of the homepage hero, in order. With no banner saved, the
            homepage shows its default category photos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={addRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) addBanner(f)
            }}
          />
          <button
            type="button"
            disabled={saving || uploading !== -1}
            onClick={() => addRef.current?.click()}
            className="inline-flex items-center gap-2 h-[46px] px-4 rounded-lg border border-black/70 text-[15px] font-medium hover:bg-black hover:text-white transition disabled:opacity-60"
          >
            {uploading === -2 ? <Loader2 size={16} className="animate-spin" /> : <Plus size={17} />}
            Add banner image
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || state.loading || !dirty}
            className="inline-flex items-center gap-2 h-[46px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save banners'}
          </button>
        </div>
      </div>

      {(state.error || (!state.loading && original.length === 0 && state.rows.length === 0)) && (
        <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">
            {state.error
              ? state.error
              : 'No banner images yet — the homepage is showing its default category photos. Add one above to replace them.'}
          </span>
        </div>
      )}

      {/* What the site shows right now: the live banners, with the photo each
          one uses and where it takes the shopper. */}
      {!state.loading && state.rows.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-black/45">
            Active on the site ({live.length} of {state.rows.length})
          </h2>
          {live.length === 0 ? (
            <p className="mt-2 text-[14px] text-black/55">
              Every banner is hidden, so the homepage is showing its default category photos.
            </p>
          ) : (
            <ul className="mt-3 grid sm:grid-cols-2 gap-3">
              {live.map((row, i) => (
                <li key={row.id || `live-${i}`} className="border border-black/10 bg-white rounded-xl p-3 flex gap-3">
                  <div className="w-[92px] h-[62px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden">
                    {row.image && <img src={row.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">Banner {i + 1}</p>
                    <p className="text-[12px] text-black/55 break-words">{describeBannerDestination(row.link)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {state.loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-4 flex items-center gap-4 animate-pulse">
              <div className="w-[120px] h-[80px] rounded-lg bg-neutral-200" />
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
            <StatusFilter value={status} onChange={setStatus} counts={counts} label="Banners" />
          </div>

          {/* The destination of each banner is chosen from the shop's own
              pages, its categories and its products — so a banner can point at
              the product it shows without anyone having to type a URL. */}
          <ul className="mt-4 space-y-3">
            {shown.map((row) => {
              // The TRUE position of this banner in the list, so the number it
              // carries and the arrows it has are the ones it really has —
              // even when a filter hides the banners in between.
              const i = state.rows.indexOf(row)
              return (
                <BannerRow
                  key={row.id || `new-${i}`}
                  row={row}
                  index={i}
                  total={state.rows.length}
                  busy={saving}
                  uploading={uploading === i}
                  canReorder={status === 'all'}
                  destinations={destinations}
                  onUrl={(url) => setRows((rows) => rows.map((r, j) => (j === i ? { ...r, image: url } : r)))}
                  onLink={(link) => setRows((rows) => rows.map((r, j) => (j === i ? { ...r, link } : r)))}
                  onToggle={() => setRows((rows) => rows.map((r, j) => (j === i ? { ...r, is_active: r.is_active === false } : r)))}
                  onMove={(dir) => move(i, dir)}
                  onRemove={() => removeAt(i)}
                  onUpload={(f) => replaceAt(i, f)}
                />
              )
            })}
          </ul>

          {!shown.length && state.rows.length > 0 && (
            <p className="mt-4 text-[15px] text-black/55">
              No banners in this state — switch the filter to All to see every banner.
            </p>
          )}

          {state.rows.length === 0 && (
            <p className="mt-4 text-[15px] text-black/55">
              No banners yet — add one above and it will be the first thing shoppers see.
            </p>
          )}
        </>
      )}

      <p className="mt-8 text-[14px] text-black/45">
        Banner photos are stored in the same secure image storage as product photos. Removing a banner here
        only removes it from the homepage — the image file itself is never deleted.
      </p>
    </div>
  )
}
