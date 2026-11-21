// The homepage hero photo's shape, in one place (homepage redesign, 21 Nov 2026).
//
// The hero card is this shape on phones AND laptops, and the admin banner
// preview (src/admin/BannerPanel.jsx) draws the same shape, so what the owner
// frames there is exactly what shoppers see. 3:4 is the shape of a photo taken
// upright on a phone, so the owner's own photos fit without losing anything.
// The old hero was nearly square on a phone (390 x 380) and cut the heads and
// hems off portrait photos.
export const HERO_RATIO = '3 / 4'
export const HERO_RATIO_VALUE = 3 / 4
// The smallest photo that stays sharp on a large phone (about 1.2 MP shown at
// 2.75x): the guideline the admin shows next to the banner upload.
export const HERO_MIN_SIZE = { width: 1200, height: 1600 }

/**
 * What the admin banner panel tells the owner about one photo, from its own
 * width and height: how much of it the 3:4 hero will cut, and whether it is
 * too small to stay sharp. Null when the photo fits. Pure, so
 * tests/heroShape.test.js checks it without a browser.
 */
export function heroPhotoNote(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return null
  const fit = (w / h) / HERO_RATIO_VALUE
  const notes = []
  // Within 8% is left alone: an Instagram 4:5 post loses only 6% at the sides.
  if (fit < 0.92) {
    notes.push(`This photo is taller than 3:4, so about ${Math.round((1 - fit) * 100)}% of its height is cut off, top and bottom. Drag the preview to keep faces in, or upload a 3:4 version.`)
  } else if (fit > 1.08) {
    notes.push(`This photo is wider than 3:4, so about ${Math.round((1 - 1 / fit) * 100)}% of its width is cut off at the sides. An upright (portrait) 3:4 photo fits best.`)
  }
  if (w < HERO_MIN_SIZE.width * 0.75) {
    notes.push(`It is only ${w} px wide and may look soft on phones; ${HERO_MIN_SIZE.width} × ${HERO_MIN_SIZE.height} px or larger stays sharp.`)
  }
  return notes.length ? notes.join(' ') : null
}
