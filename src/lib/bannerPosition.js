// Where a homepage banner photograph sits inside its frame.
//
// The hero crops every banner with `object-fit: cover`: a portrait photograph
// in a wide frame loses its top and bottom, and a photograph the owner framed
// around a face can end up showing the hem of a dress. The site's own answer
// to that is `object-position` — which part of the photograph the crop keeps —
// and this module is the ONE place that decides its value, so the preview the
// owner drags in the admin panel (src/admin/BannerPanel.jsx) and the photograph
// shoppers see (src/components/Sections.jsx) can never disagree.
//
// Nothing here ever writes to the photograph. A banner stores three numbers —
// how far right the crop starts, how far down, and how much it is enlarged —
// and the original uploaded file is never resized, re-encoded or replaced. The
// numbers can be changed, reset and changed again for as long as the banner
// exists.

/** The framing of a banner that has never been moved. 50 % across, 50 % down
 *  is dead centre — exactly what `object-position` does on its own, so a
 *  banner saved before this existed looks the same as it always has. */
export const BANNER_POSITION = Object.freeze({ x: 50, y: 50, zoom: 1 })

/** How far a photograph may be enlarged. 1 is no enlargement at all. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 2

const number = (value) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const between = (value, min, max, fallback) => {
  const n = number(value)
  if (n === null) return fallback
  return Math.min(max, Math.max(min, n))
}

/** The focus point, 0–100 across. Rounded so a stored value and the value it
 *  renders as are the same number — a long float would make the admin panel
 *  think a banner had been moved when it had not. */
export const clampFocusX = (value) => Math.round(between(value, 0, 100, BANNER_POSITION.x) * 100) / 100
export const clampFocusY = (value) => Math.round(between(value, 0, 100, BANNER_POSITION.y) * 100) / 100
export const clampZoom = (value) => Math.round(between(value, ZOOM_MIN, ZOOM_MAX, BANNER_POSITION.zoom) * 100) / 100

/**
 * A banner's framing, read straight from its row.
 *
 * Every value is read defensively: a banner saved before these columns existed
 * has none of them, a hand-edited row could hold anything, and neither may put
 * a photograph in a place the browser cannot draw. Missing or impossible means
 * the centre, no enlargement.
 *
 * Both spellings are read — `focus_x` as the column stores it, and `x` as the
 * in-memory framing the drag and keyboard maths passes around — so a value can
 * be read back the moment it is produced, without first being written
 * somewhere.
 */
export function bannerPosition(row) {
  return {
    x: clampFocusX(row?.focus_x ?? row?.x),
    y: clampFocusY(row?.focus_y ?? row?.y),
    zoom: clampZoom(row?.zoom),
  }
}

/** Two framings are the same — used by the admin panel to decide whether the
 *  owner has actually changed anything. */
export const samePosition = (a, b) => {
  const one = bannerPosition(a)
  const two = bannerPosition(b)
  return one.x === two.x && one.y === two.y && one.zoom === two.zoom
}

/**
 * The inline styles that draw a photograph at a framing.
 *
 * `object-position` says which part of the photograph the `cover` crop keeps;
 * the zoom is a `scale()` about the very point the owner framed, so enlarging
 * a photograph never slides her subject back out of the picture.
 *
 * A zoom of 1 produces no transform at all — the default banner is rendered by
 * exactly the same markup it has always been rendered by.
 */
export function bannerPositionStyle(position) {
  const { x, y, zoom } = bannerPosition(position)
  const style = { objectPosition: `${x}% ${y}%` }
  if (zoom !== 1) {
    style.transform = `scale(${zoom})`
    style.transformOrigin = `${x}% ${y}%`
  }
  return style
}

/**
 * How large a photograph is drawn inside a box that crops it with `cover`.
 *
 * The largest size at which the photograph still fills the box — the size
 * `object-fit: cover` picks on its own, before any zoom.
 */
export function coverSize(naturalWidth, naturalHeight, boxWidth, boxHeight) {
  const nw = number(naturalWidth)
  const nh = number(naturalHeight)
  const bw = number(boxWidth) || 0
  const bh = number(boxHeight) || 0
  // A photograph that has not loaded yet has no size; the box is the honest
  // answer until it does, and dragging simply does nothing (see below).
  if (!(nw > 0 && nh > 0) || !(bw > 0 && bh > 0)) return { w: bw, h: bh }
  const scale = Math.max(bw / nw, bh / nh)
  return { w: nw * scale, h: nh * scale }
}

/**
 * The framing after a photograph has been dragged by (dx, dy) screen pixels.
 *
 * `origin` is the framing at the moment the owner's finger went down, not the
 * framing one frame earlier — dragging is then measured against a fixed point
 * and cannot drift no matter how many events the browser sends.
 *
 * The direction: dragging a photograph to the RIGHT shows more of its LEFT
 * side, so the focus point moves left. The distance is measured against the
 * part of the photograph that is actually outside the frame — the pan range —
 * so a drag from edge to edge really does travel from one end of the picture
 * to the other, at any zoom.
 */
export function focusAfterDrag(origin, delta, geometry) {
  const start = bannerPosition(origin)
  const dx = number(delta?.dx) || 0
  const dy = number(delta?.dy) || 0
  const { naturalWidth, naturalHeight, boxWidth, boxHeight } = geometry || {}
  const zoomed = coverSize(naturalWidth, naturalHeight, boxWidth, boxHeight)
  const bw = number(boxWidth) || 0
  const bh = number(boxHeight) || 0
  // A zoomed photograph behaves exactly like a larger one cropped to the same
  // box (see `bannerPositionStyle`), so the pan range grows with the zoom.
  const rangeX = Math.max(0, start.zoom * zoomed.w - bw)
  const rangeY = Math.max(0, start.zoom * zoomed.h - bh)
  return {
    ...start,
    // No pan room means the photograph fills the frame exactly (or has not
    // loaded): there is nothing to slide, so the framing stands still rather
    // than jumping somewhere arbitrary.
    x: rangeX > 0 ? clampFocusX(start.x - (dx / rangeX) * 100) : start.x,
    y: rangeY > 0 ? clampFocusY(start.y - (dy / rangeY) * 100) : start.y,
  }
}

/** The direction an arrow key moves the framing, in the SAME direction a drag
 *  would: dragging a photograph to the right shows more of its left side, so
 *  the focus point moves left. */
export function focusAfterNudge(origin, dxPercent, dyPercent) {
  const start = bannerPosition(origin)
  return {
    ...start,
    x: clampFocusX(start.x - (number(dxPercent) || 0)),
    y: clampFocusY(start.y - (number(dyPercent) || 0)),
  }
}

/** The three numbers a banner stores. Sent with every save, so a framing is
 *  written for a new banner and cleared back to the centre by "Reset". */
export const positionColumns = (position) => {
  const { x, y, zoom } = bannerPosition(position)
  return { focus_x: x, focus_y: y, zoom }
}
