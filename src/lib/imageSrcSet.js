// The smaller copy of a photograph the browser may be offered.
//
// The client's photos are 688–1086 px wide and are shown in lists at
// 272–300 CSS pixels, so the full-size file is roughly twice what the screen
// needs. A 640-pixel copy — produced from the client's own file by
// scripts/build-image-derivatives.mjs — is exactly enough for the largest of
// those, and a big screen is still offered the original.
//
// Only the photographs that ship with the site have such a copy; a photo
// uploaded to the store's own storage is offered as it is.
export const IMAGE_SIZES = { small: 640, logo: 320 }

/**
 * The `srcset` for a bundled photograph, or undefined when there is no
 * smaller copy to offer.
 */
export function imageSrcSet(src) {
  if (typeof src !== 'string' || !src.startsWith('/images/')) return undefined
  const match = src.match(/^(.*)\.(jpe?g|png)$/i)
  if (!match) return undefined
  const width = /ruhi-logo/.test(src) ? IMAGE_SIZES.logo : IMAGE_SIZES.small
  return `${match[1]}-${width}.jpg ${width}w, ${src} 1600w`
}
