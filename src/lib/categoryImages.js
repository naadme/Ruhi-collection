// The rules behind the admin's category photos.
//
// Kept apart from the store calls (src/lib/categoryImageStore.js) so they
// can be tested without a browser runtime, and apart from the panel so the
// same rules are used wherever a photo is chosen.

import { img } from '../data/images.js'

export const CATEGORY_IMAGE_BUCKET = 'product-images'
export const CATEGORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * The picture formats a category photo may be.
 *
 * A browser reports an unknown type as an empty string, so a file whose type
 * it cannot name is judged by its extension instead. SVG is deliberately not
 * on the list: it is a document that can carry script, and a category photo
 * has no reason to be one.
 */
export const CATEGORY_IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]

const CATEGORY_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']

/**
 * The photographs that ship with the site. The owner can pick one of these
 * instead of uploading a file — they are the same pictures the homepage uses
 * by default, so a category never ends up with a broken photograph.
 */
export const CATEGORY_IMAGE_OPTIONS = [
  { label: 'Denim shirt, blue', url: img.catTops },
  { label: 'Co-ord set, beige', url: img.catCoord },
  { label: 'Striped dress, blue', url: img.catDress },
  { label: 'Denim pant, black', url: img.catTrousers },
  { label: 'Embroidered co-ord set, olive', url: img.aboutB },
  { label: 'Denim dress', url: img.heroStore },
  { label: 'Shorts and shirt, royal blue', url: img.heroMain },
]

/** The file's extension, lower-cased and without the dot. */
const extensionOf = (file) => {
  const name = String(file?.name || '')
  const at = name.lastIndexOf('.')
  return at < 0 ? '' : name.slice(at + 1).toLowerCase()
}

/**
 * The check every upload goes through. Returns the sentence to show, or an
 * empty string when the file is fine.
 *
 * The type is checked first — a file that is not a photograph at all is
 * refused before its size is considered — and the size second, so the owner is
 * told the more important thing first.
 */
export const validateCategoryImage = (file) => {
  if (!file) return 'Please choose an image file.'
  const type = String(file.type || '').toLowerCase()
  const extension = extensionOf(file)
  if (type) {
    if (!type.startsWith('image/')) return 'Please choose an image file.'
    if (!CATEGORY_IMAGE_TYPES.includes(type) && extension && !CATEGORY_IMAGE_EXTENSIONS.includes(extension)) {
      return 'Please choose a JPEG, PNG, WebP, GIF or AVIF image file.'
    }
  } else if (!CATEGORY_IMAGE_EXTENSIONS.includes(extension)) {
    // The browser could not name the type, so the extension decides.
    return 'Please choose a JPEG, PNG, WebP, GIF or AVIF image file.'
  }
  if (Number(file.size) > CATEGORY_IMAGE_MAX_BYTES) return 'Images must be smaller than 5 MB.'
  if (!Number(file.size)) return 'That image file is empty.'
  return ''
}
