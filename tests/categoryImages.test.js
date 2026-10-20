// The admin's category photos: the file that is allowed, the file that is
// not, and the migration that makes the choice storable.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  CATEGORY_IMAGE_BUCKET,
  CATEGORY_IMAGE_MAX_BYTES,
  CATEGORY_IMAGE_OPTIONS,
  validateCategoryImage,
} from '../src/lib/categoryImages.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const MIG = 'supabase/migrations/20261020180000_category_images.sql'

const file = (name, type, size) => ({ name, type, size })

test('only an image may be uploaded', () => {
  assert.equal(validateCategoryImage(file('a.jpg', 'image/jpeg', 1000)), '')
  assert.equal(validateCategoryImage(file('a.png', 'image/png', 1000)), '')
  assert.match(validateCategoryImage(file('a.pdf', 'application/pdf', 1000)), /image file/i)
  assert.match(validateCategoryImage(file('a.txt', 'text/plain', 1000)), /image file/i)
  assert.match(validateCategoryImage(null), /image file/i)
})

test('a photo that is too large is refused with a size the owner can read', () => {
  assert.equal(validateCategoryImage(file('big.jpg', 'image/jpeg', CATEGORY_IMAGE_MAX_BYTES)), '',
    'exactly at the limit is allowed')
  assert.match(validateCategoryImage(file('big.jpg', 'image/jpeg', CATEGORY_IMAGE_MAX_BYTES + 1)), /5 MB/i)
})

test('the photos are stored in the bucket the site already uses', () => {
  assert.equal(CATEGORY_IMAGE_BUCKET, 'product-images')
})

test('the site\'s own photographs can be chosen instead of uploading', () => {
  assert.ok(CATEGORY_IMAGE_OPTIONS.length >= 4, 'there is a choice to make')
  for (const option of CATEGORY_IMAGE_OPTIONS) {
    assert.match(option.url, /^\/images\/products\/.+\.jpg$/, 'a photograph that ships with the site')
    assert.ok(option.label.length > 3)
  }
  const urls = CATEGORY_IMAGE_OPTIONS.map((o) => o.url)
  assert.equal(new Set(urls).size, urls.length, 'and no photograph is listed twice')
})

test('the migration only adds a column, and can be taken back', () => {
  const sql = read(MIG)
  assert.match(sql, /alter table public\.categories\s*\n?\s*add column if not exists image text/i)
  assert.doesNotMatch(sql, /drop table/i, 'nothing is dropped')
  assert.doesNotMatch(sql, /delete from/i, 'no row is deleted')
  assert.doesNotMatch(sql, /update public\.categories/i, 'and no existing category is rewritten')
  assert.doesNotMatch(sql, /create policy/i, 'the existing admin-only RLS is left exactly as it is')
})

test('the migration is the newest one', () => {
  const files = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations')).sort()
  assert.equal(files[files.length - 1], '20261020180000_category_images.sql')
})
