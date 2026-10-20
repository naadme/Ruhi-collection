import derivatives from './imageDerivatives.js'

// The smaller copy of a photograph the browser may be offered.
//
// The client's photos are 688–1086 px wide and are shown in lists at
// 272–300 CSS pixels, so the full-size file is roughly twice what the screen
// needs. A 640-pixel copy — produced from the client's own file by
// scripts/build-image-derivatives.mjs — is exactly enough for the largest of
// those, and a big screen is still offered the original.
//
// Only the photographs that ship with the site have such a copy; a photo
// uploaded to the store's own storage is offered as it is. The list of those
// photographs, with their real widths, is written by the same script and read
// here, so a photograph that was added without a copy is served as it is
// rather than pointing the browser at a file that is not there.
export const IMAGE_SIZES = { small: 640, logo: 320 }

/**
 * The copies of one bundled photograph: the smaller one and the original.
 *
 * `null` when the photograph has no smaller copy — an uploaded photo, or one
 * that was added to the folder without running the copy script.
 */
export function imageCopy(src) {
  if (typeof src !== 'string') return null
  const copy = derivatives[src]
  if (!copy) return null
  return {
    small: src.replace(/\.jpe?g$/i, `-${copy.small}.jpg`),
    original: src,
    srcset: `${src.replace(/\.jpe?g$/i, `-${copy.small}.jpg`)} ${copy.small}w, ${src} ${copy.original}w`,
  }
}

/**
 * The `srcset` for a bundled photograph, or undefined when there is no
 * smaller copy to offer.
 */
export function imageSrcSet(src) {
  return imageCopy(src)?.srcset
}
