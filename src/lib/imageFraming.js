// Framing for ONE stored photograph: which part of it a frame keeps, and how
// much it is enlarged. The original file is never touched — only three numbers
// travel beside it (see supabase/migrations/20261026090000_image_framing.sql).
//
// Every photograph in the shop uses the SAME rule that homepage banners use
// (src/lib/bannerPosition.js): `object-position` says what the `cover` crop
// keeps, and `scale()` about the framed point enlarges without sliding the
// subject back out of the picture. This module is the storefront's half of
// that rule: given a map of "image URL → framing" and one URL, it returns the
// styles to draw that photograph.
//
// A product's `image_framing` column holds exactly such a map, keyed by the
// photograph's own address — because the storefront draws a photograph by its
// address, and an entry whose URL no longer matches anything simply does not
// apply when a photograph has been replaced or removed.

import {
  BANNER_POSITION,
  ZOOM_MIN,
  ZOOM_MAX,
  bannerPosition,
  bannerPositionStyle,
  clampFocusX,
  clampFocusY,
  clampZoom,
  positionColumns,
  samePosition,
} from './bannerPosition.js'

/** The framing one stored photograph keeps, read defensively:
 *  a row saved before this existed has no entry for its photographs,
 *  and a replaced photograph has no framing of its own yet — both mean
 *  centre, no enlargement. */
export const imageFramingOf = (framingByUrl, url) => {
  const entry = framingByUrl && typeof framingByUrl === 'object' ? framingByUrl[url] : undefined
  return bannerPosition(entry ? { focus_x: entry.x, focus_y: entry.y, zoom: entry.zoom } : null)
}

/** Inline styles that draw one photograph at its framing: `object-position`
 *  plus a `scale()` about the framed point when zoomed. */
export const imageFramingStyle = (framingByUrl, url) =>
  bannerPositionStyle(imageFramingOf(framingByUrl, url))

/** The three columns to write beside one photograph: focus_x, focus_y, zoom. */
export const imageFramingColumns = (framing) => positionColumns(framing)

/** Do two framing maps describe the same photographs? Key order does not
 *  matter: the database stores jsonb with its own key ordering, so two maps
 *  that agree entry for entry are the same framing even if the keys arrived
 *  in a different order. */
export const framingEqual = (a, b) => {
  const sa = JSON.stringify(Object.entries(a || {}).sort())
  const sb = JSON.stringify(Object.entries(b || {}).sort())
  return sa === sb
}

export { BANNER_POSITION, ZOOM_MIN, ZOOM_MAX, bannerPosition, bannerPositionStyle, clampFocusX, clampFocusY, clampZoom, positionColumns, samePosition }
