// Storing the photo a category shows.
//
// The file goes into the same public storage bucket the product editor and
// the homepage banners use (`product-images`), and the chosen photo is
// written to the `categories` row itself — so it is a value, not a code
// change: it survives a reload, a redeployment and a fresh checkout of the
// repository, and the storefront picks it up on its next read.
//
// Writes to `categories` are gated on is_admin() by the table's own RLS, so
// this can never be done by a signed-in visitor.

import { supabase } from './supabase.js'
import { CATEGORY_IMAGE_BUCKET, validateCategoryImage } from './categoryImages.js'

/**
 * The sentence shown when the storage refuses a file.
 *
 * The two failures an owner can actually do something about are named
 * separately: a file the storage will not accept, and a session that is not
 * allowed to write to the bucket. Everything else is reported as it came.
 */
const uploadProblem = (error) => {
  const message = String(error?.message || '')
  if (/row-level security|not authorized|permission denied/i.test(message)) {
    return 'The image storage refused this upload. Only an admin account can add photographs — please sign in as the store owner and try again.'
  }
  if (/exceeded|quota|too large|payload too large/i.test(message)) {
    return 'The image storage would not accept this file. Please try a smaller photograph.'
  }
  if (/mime|type|not allowed|unsupported/i.test(message)) {
    return 'The image storage would not accept this kind of file. Please choose a JPEG, PNG, WebP, GIF or AVIF image.'
  }
  return message || 'The photo could not be uploaded. Please try again.'
}

/**
 * Upload a photograph to the store's image storage and return its public
 * address. The file name carries a timestamp so an upload can never
 * overwrite another category's picture.
 */
export const uploadCategoryImage = async (file) => {
  const problem = validateCategoryImage(file)
  if (problem) throw new Error(problem)
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `category-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(CATEGORY_IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(uploadProblem(error))
  const { data } = supabase.storage.from(CATEGORY_IMAGE_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('The photo was uploaded but its address could not be read.')
  return data.publicUrl
}

/**
 * Save the photo for one category. An empty value means "use the site's
 * default photograph for this category" — the storefront then falls back to
 * the picture it has always used.
 *
 * `isActive` says whether the category's own photograph is the one the site
 * shows. It is left out of the write when it is not given, so a caller that
 * only wants to change the picture cannot accidentally switch the picture
 * off (or back on) by accident.
 */
export const saveCategoryImage = async (key, image, isActive) => {
  const value = String(image ?? '').trim() || null
  const payload = { image: value }
  if (isActive !== undefined) payload.image_active = isActive !== false
  const { data, error } = await supabase
    .from('categories')
    .update(payload)
    .eq('key', key)
    .select('key, label, image, image_active')
    .single()
  if (error || !data?.key) {
    throw new Error(error?.message || 'Nothing was saved — your session may have expired.')
  }
  return data
}

/**
 * Switch one category's photograph on or off, leaving the photograph itself
 * exactly as it is. The category keeps its name, its products and its place
 * in the navigation; only the picture the site shows for it changes.
 */
export const setCategoryImageActive = async (key, isActive) => {
  const { data, error } = await supabase
    .from('categories')
    .update({ image_active: isActive !== false })
    .eq('key', key)
    .select('key, label, image, image_active')
    .single()
  if (error || !data?.key) {
    throw new Error(error?.message || 'Nothing was saved — your session may have expired.')
  }
  return data
}
