import derivatives from './imageDerivatives.js'

// The smaller copy of a photograph the browser may be offered.
//
// The client's photos are 688–1086 px wide and are shown in lists at
// 272–300 CSS pixels, so the full-size file is roughly twice what the screen
// needs. A 640-pixel copy — produced from the client's own file by
// scripts/build-image-derivatives.mjs — is exactly enough for the largest of
// those, and a big screen is still offered the original.
//
// The list of the photographs that ship with the site, with their real
// widths, is written by the same script and read here, so a photograph that
// was added without a copy is served as it is rather than pointing the
// browser at a file that is not there. Uploaded photos are handled below.
export const IMAGE_SIZES = { small: 640, logo: 320 }

// Photos uploaded through the admin panel are stored at the size the phone
// took them (up to 2268×4032 px and 1.3 MB on 8 Nov 2026), and most product
// photos are uploads. Supabase can serve a smaller copy of any of them: the
// same path under `/render/image/` instead of `/object/`, with a width.
//
// `resize=contain` is not optional. With only a width, Supabase's default
// (`cover`) keeps the photo's full height and crops it to a narrow strip —
// a 640-wide request came back 640×4032 (checked 8 Nov 2026). `contain` keeps
// the proportions (640×1138) and never makes a photo larger than it is.
// Browsers that accept WebP are sent WebP, which is most of the saving.
export const UPLOAD_WIDTHS = [320, 480, 640, 960, 1280]
const UPLOAD_QUALITY = 80
const STORAGE_OBJECT = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/([^?#]+)$/

/** The address of a smaller copy of an uploaded photo, or `null` if `src` is not one. */
export function resizedUpload(src, width) {
  const match = typeof src === 'string' ? STORAGE_OBJECT.exec(src) : null
  if (!match) return null
  return `${match[1]}/render/image/public/${match[2]}?width=${width}&resize=contain&quality=${UPLOAD_QUALITY}`
}

/**
 * The copies of one photograph: the smaller one and the original.
 *
 * `null` when the photograph has no smaller copy — a bundled photo that was
 * added to the folder without running the copy script, or a photo hosted
 * anywhere other than the site or its own Supabase storage.
 */
export function imageCopy(src) {
  if (typeof src !== 'string') return null
  if (resizedUpload(src, IMAGE_SIZES.small)) {
    return {
      small: resizedUpload(src, IMAGE_SIZES.small),
      original: src,
      srcset: UPLOAD_WIDTHS.map((w) => `${resizedUpload(src, w)} ${w}w`).join(', '),
    }
  }
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
