// The admin panel's store calls: the exact statements it sends to Supabase.
//
// The Supabase client is replaced with a recording stand-in, so these tests
// see what the panel really asks for — the table, the row, the payload — and
// not a description of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// Point the module under test at the stand-in.
const MOCK = new URL('./helpers/supabase-mock.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './supabase.js' && String(context.parentURL).includes('categoryImageStore.js')) {
      return { url: MOCK, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { calls, reset, state } = await import('./helpers/supabase-mock.mjs')
const { saveCategoryImage, uploadCategoryImage } = await import('../src/lib/categoryImageStore.js')

const find = (name) => calls.find((c) => c.name === name)

test('saving a photo writes it to that category and nothing else', async () => {
  reset()
  await saveCategoryImage('coord', 'https://example.com/chosen.jpg')
  const update = find('from(categories).update')
  assert.ok(update, 'the categories table is written')
  assert.deepEqual(update.args, { image: 'https://example.com/chosen.jpg' })
  const eq = find('from(categories).eq')
  assert.deepEqual(eq.args, ['key', 'coord'], 'and only that category')
})

test('an empty photo means "use the site\'s default", not an empty picture', async () => {
  reset()
  await saveCategoryImage('coord', '   ')
  const update = find('from(categories).update')
  assert.deepEqual(update.args, { image: null })
})

test('a refused save is reported, and never reported as done', async () => {
  reset()
  state.failUpdate = true
  await assert.rejects(
    () => saveCategoryImage('coord', 'https://example.com/chosen.jpg'),
    /permission denied/i,
  )
})

test('an upload is checked before anything is stored', async () => {
  reset()
  await assert.rejects(() => uploadCategoryImage({ name: 'a.pdf', type: 'application/pdf', size: 10 }), /image file/i)
  await assert.rejects(() => uploadCategoryImage({ name: 'a.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 }), /5 MB/i)
  assert.equal(calls.length, 0, 'nothing was sent to the storage')
})

test('an uploaded photo is stored in the site\'s own bucket and returns its address', async () => {
  reset()
  const url = await uploadCategoryImage({ name: 'my photo.JPG', type: 'image/jpeg', size: 1024 })
  const upload = find('storage(product-images).upload')
  assert.ok(upload, 'the existing image bucket is used')
  assert.match(upload.args[0], /^category-\d+\.jpg$/, 'with a name no other photo can take')
  assert.equal(upload.args[2].upsert, false, 'an upload never overwrites another')
  assert.equal(url, state.uploadUrl, 'and the address the owner sees is the one that was stored')
})

test('a failed upload is reported, not swallowed', async () => {
  reset()
  state.failUpload = true
  await assert.rejects(
    () => uploadCategoryImage({ name: 'a.jpg', type: 'image/jpeg', size: 1024 }),
    /could not be stored/i,
  )
})
