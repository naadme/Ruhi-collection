// The rules behind the admin's category photos.
//
// Kept apart from the store calls (src/lib/categoryImageStore.js) so they
// can be tested without a browser runtime, and apart from the panel so the
// same rules are used wherever a photo is chosen.

import { img } from '../data/images.js'

export const CATEGORY_IMAGE_BUCKET = 'product-images'
export const CATEGORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024

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

/**
 * The check every upload goes through. Returns the sentence to show, or an
 * empty string when the file is fine.
 */
export const validateCategoryImage = (file) => {
  if (!file) return 'Please choose an image file.'
  if (!String(file.type || '').startsWith('image/')) return 'Please choose an image file.'
  if (Number(file.size) > CATEGORY_IMAGE_MAX_BYTES) return 'Images must be smaller than 5 MB.'
  return ''
}
