// What the homepage hero slides between, and when its arrows appear.
//
// Moved out of src/components/Sections.jsx so the rule can be unit-tested in
// plain Node — it is the part that decides both which photos a shopper sees
// and whether the carousel still has working previous/next controls.
//
// The rule
//   slides = the admin's saved banners, IN SAVED ORDER, followed by the
//            default category photos.
//
// The banners come first and are what the hero opens on, so an admin who
// saves a banner still gets exactly the photo they chose first. The default
// photos stay on the END of the list rather than being thrown away, because
// throwing them away is what caused the bug this module fixes: with the
// banners *replacing* the list, saving the FIRST banner left the carousel
// with a single slide, and the arrows — which only appear when there is
// something to navigate to — disappeared the moment the owner saved a banner
// and came back only once a second one existed.
//
// With no banners saved the list is exactly the default photos, which is the
// store's original slider, unchanged.

import { bannerDestination } from './bannerLinks.js'

/**
 * @param {Array} banners rows from the `banners` table, in saved order
 * @param {Array} fallback slides the hero already knew how to show
 * @returns {Array} every slide, banners first
 */
export function heroSlides(banners, fallback) {
  const base = (Array.isArray(fallback) ? fallback : []).filter(Boolean)
  const saved = (Array.isArray(banners) ? banners : [])
    // A row with no photo is not a slide. `fetchHomeBanners` already drops
    // these; the check is kept here too so a malformed row can never put a
    // blank photo — and therefore a dead arrow — on the homepage.
    .filter((row) => row && typeof row.image === 'string' && row.image.trim())
    // A banner the owner has switched off is kept in the admin panel but is
    // not shown on the site.
    .filter((row) => row.is_active !== false)
    .map((row) => ({
      key: String(row.id ?? row.image),
      image: row.image,
      // Each banner has its OWN destination. A destination that is missing or
      // that the site cannot open falls back to the shop, so a banner can
      // never send a shopper to a broken page.
      to: bannerDestination(row.link),
      label: 'Shop now',
    }))
  return [...saved, ...base]
}

/** Arrows appear exactly when there is somewhere to go: more than one slide.
 *  With nothing at all the right half stays blank (see the zero-slide guard
 *  in Sections.jsx) and with a single slide the controls would be dead
 *  buttons, so neither shows them. */
export const showArrows = (slides) => (Array.isArray(slides) ? slides.length : 0) > 1

/** Wrap-around index, safe for an empty list (`at % 0` is NaN). */
export const slideAt = (at, n) => {
  const count = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
  if (!count) return null
  const i = Number.isFinite(at) ? Math.trunc(at) : 0
  return ((i % count) + count) % count
}
