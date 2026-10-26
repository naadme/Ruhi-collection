// The photographs of the SITES OWN PAGES — the About hero, the Contact strip,
// the homepage "Our story" picture and the two editorial pictures on About.
//
// These used to live only in src/data/images.js, so changing one meant editing
// source and redeploying. They now live in the same `banners` table the
// homepage hero already uses, under a `slot` of their own, and are edited with
// the same drag-and-zoom control (src/admin/FrameBox.jsx). There is no second
// table and no second image store — a page photograph is a banner for a page
// that shows one instead of a slider.
//
//   * `banners.slot` = 'about_hero' | 'contact_hero' | 'story' |
//                      'about_a' | 'about_b'
//
// The homepage reads `slot = 'home_hero'` only (src/lib/banners.js), so these
// rows can never leak into its slider, and its slider's rows can never be
// mistaken for a page's.
//
// UNTIL a row exists the page keeps showing the photograph and the framing
// written below — the same photograph it has always shown — so this module
// changes nothing on the site until the owner saves a page image in the
// portal. That fallback is also why the framing lives here rather than in the
// page: the panel and the page must start from the SAME numbers, or the first
// save would silently move the picture.
//
// Nothing here touches a file. A framing is three numbers applied with CSS on
// the way out; the uploaded photograph stays byte for byte what it was.

import { useEffect, useReducer } from 'react'
import { img } from '../data/images.js'
import { bannerPosition, bannerPositionStyle } from './bannerPosition.js'

/**
 * Every page photograph the portal can manage.
 *
 * `fallback` is what the page shows until a row is saved: the photograph from
 * src/data/images.js, plus the framing that makes it sit right in the frame it
 * is actually drawn into. Those framings are not guesses about taste — they
 * are the position at which the subject of each photograph is NOT cut in half
 * by a frame that is far wider or far taller than the picture.
 *
 * The preview shapes are the frame each picture is really drawn into, taken
 * from the page's own CSS so the admin cannot frame against a rectangle the
 * visitor never sees:
 *
 *   About hero   h-[70vh] min-h-[440px], full width  (src/pages/About.jsx)
 *   Contact      h-[160px] md:h-[220px], full width  (src/pages/Contact.jsx)
 *   Our story    aspect-square                        (src/components/Sections.jsx)
 *   About A/B    aspect-[4/3] and aspect-[4/5]        (src/pages/About.jsx)
 *
 * A full-width frame is a different shape on a laptop than on a phone — the
 * About hero is about twice as wide as it is tall on a desktop and about half
 * as wide as it is tall on a phone — so both are previewed.
 */
export const PAGE_IMAGES = [
  {
    slot: 'about_hero',
    page: 'About',
    label: 'About page — hero',
    note: 'The full-width photograph behind “Dressed well, every single day.”',
    fallback: { image: img.aboutHero, focus_x: 50, focus_y: 0, zoom: 1 },
    desktop: '1440 / 630',
    phone: '390 / 591',
  },
  {
    slot: 'contact_hero',
    page: 'Contact',
    label: 'Contact page — banner',
    note: 'The wide strip behind “Contact us”. A flat-lay suits a band this thin; a face does not.',
    fallback: { image: img.contact, focus_x: 50, focus_y: 38, zoom: 1 },
    desktop: '1440 / 220',
    phone: '390 / 160',
  },
  {
    slot: 'story',
    page: 'Home',
    label: 'Home page — “Our story”',
    note: 'The square picture beside the story on the homepage.',
    fallback: { image: img.story, focus_x: 50, focus_y: 50, zoom: 1 },
    desktop: '1 / 1',
    phone: '1 / 1',
  },
  {
    slot: 'about_a',
    page: 'About',
    label: 'About page — first picture',
    note: 'The wider of the two pictures under the story.',
    fallback: { image: img.aboutA, focus_x: 50, focus_y: 35, zoom: 1 },
    desktop: '4 / 3',
    phone: '4 / 3',
  },
  {
    slot: 'about_b',
    page: 'About',
    label: 'About page — second picture',
    note: 'The taller picture, set a little lower.',
    fallback: { image: img.aboutB, focus_x: 50, focus_y: 35, zoom: 1 },
    desktop: '4 / 5',
    phone: '4 / 5',
  },
]

/** The slots in one list, for the single query that reads them. */
export const PAGE_IMAGE_SLOTS = PAGE_IMAGES.map((p) => p.slot)

const bySlot = new Map(PAGE_IMAGES.map((p) => [p.slot, p]))

/** The definition above, or undefined for a slot this module does not know. */
export const pageImage = (slot) => bySlot.get(slot)

// One read for the whole site. Several pages ask for their photograph at the
// same moment (the About page wants three), and a module-level promise means
// they share one request rather than racing three.
let cache = null
let pending = null
const listeners = new Set()

const publish = (rows) => {
  cache = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.image === 'string' && row.image.trim()) cache.set(row.slot, row)
  }
  for (const listener of listeners) listener()
  return cache
}

/** Read every page photograph once. Never rejects: a page that cannot reach
 *  the database simply keeps the photograph it already has. */
export function loadPageImages() {
  if (cache) return Promise.resolve(cache)
  if (!pending) {
    pending = (async () => {
      // Imported inside the function so this module stays importable outside
      // a browser (the Supabase client reads VITE_SUPABASE_URL at import time).
      const { supabase } = await import('./supabase.js')
      const { data, error } = await supabase
        .from('banners')
        .select('*')
        .in('slot', PAGE_IMAGE_SLOTS)
      // An error is not "there are no rows": either way the pages fall back,
      // so the cache is filled either way and this is never asked twice.
      publish(error ? [] : data)
      return cache
    })().catch(() => publish([]))
  }
  return pending
}

/** Test seam: forget what has been read, so a test can read again. */
export function resetPageImages() {
  cache = null
  pending = null
}

/**
 * What one page slot shows: its photograph and the styles that frame it.
 *
 * Reads the saved row when there is one, and the fallback above when there is
 * not — so a page is never blank while the read is in flight, and never
 * changes shape when the read finishes.
 */
export function pageImageFor(slot, rows) {
  const def = bySlot.get(slot)
  if (!def) return { image: '', style: {} }
  const row = rows instanceof Map ? rows.get(slot) : null
  const source = row || def.fallback
  const framing = row
    ? bannerPosition(row)
    : bannerPosition(def.fallback)
  return {
    image: source.image || '',
    style: bannerPositionStyle(framing),
    fromDatabase: Boolean(row),
  }
}

/**
 * The photograph of a page slot, ready to render.
 *
 * Subscribes to the one shared read, so the picture appears as soon as it
 * arrives and every page asking for it updates together.
 */
export function usePageImage(slot) {
  const rerender = useReducer((n) => n + 1, 0)[1]
  useEffect(() => {
    listeners.add(rerender)
    loadPageImages()
    return () => { listeners.delete(rerender) }
  }, [rerender])
  return pageImageFor(slot, cache)
}
