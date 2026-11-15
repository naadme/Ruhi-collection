// The admin's "prove it saved" check, for products with a framed photo.
//
// On 14 Nov 2026 adding a product with a framed photo failed with
// "Supabase stored different values for image_framing — this change was not
// saved", although every press of "Add product" HAD created the product: the
// check compared the framing map by object identity, and the row Supabase
// sends back is always a new object. These tests pin both halves of the fix:
// a framing that came back as sent passes, and a write that really did come
// back different says it landed and hands the stored row back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const MOCK = new URL('./helpers/supabase-mock.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (String(context.parentURL).includes('productApi.js')) {
      if (specifier === '../lib/supabase') return { url: MOCK, shortCircuit: true }
      // Vite resolves extensionless imports; Node needs the `.js`.
      if (specifier === '../lib/productForm') return nextResolve(`${specifier}.js`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { calls, reset, state } = await import('./helpers/supabase-mock.mjs')
const { assertSaved, createProduct, updateProduct } = await import('../src/admin/productApi.js')
const { same } = await import('../src/lib/productForm.js')

const PHOTO = 'https://example.supabase.co/storage/v1/object/public/product-images/flower-yellow-photo1.png'

/** What PostgREST hands back for a jsonb column: a fresh object, keys in
 *  jsonb's own order (shorter keys first), never the object that was sent. */
const fromDb = (v) => JSON.parse(JSON.stringify(v))

const payload = () => ({
  id: 'flower-embroided-co-ord-set-yellow',
  title: 'Flower embroided co-ord set - Yellow',
  price: 849,
  sizes: ['M', 'L', 'XL'],
  image: PHOTO,
  is_active: true,
  image_framing: { [PHOTO]: { zoom: 1.15, x: 50, y: 50 } },
})

test('a framing map is the same framing when it comes back as a new object', () => {
  const sent = { [PHOTO]: { x: 50, y: 50, zoom: 1.15 } }
  assert.ok(same(fromDb(sent), sent), 'a copy of the same map')
  assert.ok(same({ [PHOTO]: { y: 50, zoom: 1.15, x: 50 } }, sent), 'keys in another order')
  assert.ok(!same({ [PHOTO]: { x: 0, y: 0, zoom: 1 } }, sent), 'a different framing is different')
  assert.ok(!same(null, sent), 'no framing is not a framing')
  assert.ok(same(null, null) && same(undefined, null), 'no framing either way is the same')
})

test('lists still compare in order, and the old rules for other columns hold', () => {
  assert.ok(same(['M', 'L'], ['M', 'L']))
  assert.ok(!same(['L', 'M'], ['M', 'L']), 'size order matters')
  assert.ok(same('0.0', 0), 'a numeric column read back as text')
  assert.ok(same(null, undefined))
  assert.ok(!same('a', 'b'))
})

test('adding a product with a framed photo succeeds when Supabase stored it as sent', async () => {
  reset()
  const sent = payload()
  state.singleRow = { ...fromDb(sent), image_framing: { [PHOTO]: { x: 50, y: 50, zoom: 1.15 } }, sku: '0275YE' }
  const row = await createProduct(sent)
  assert.equal(row.id, sent.id)
  assert.ok(calls.find((c) => c.name === 'from(products).insert'), 'the product was inserted')
})

test('editing only the framing of a product succeeds too', async () => {
  reset()
  const sent = { id: 'floral-maxi-dress-black', image_framing: { [PHOTO]: { x: 40, y: 30, zoom: 1.2 } } }
  state.singleRow = { id: sent.id, image_framing: fromDb(sent.image_framing) }
  const row = await updateProduct(sent)
  assert.equal(row.id, sent.id)
})

test('a write that really came back different says it landed and returns the stored row', async () => {
  reset()
  const sent = payload()
  const stored = { ...fromDb(sent), price: 799 }
  state.singleRow = stored
  await assert.rejects(
    () => createProduct(sent),
    (err) => {
      assert.match(err.message, /saved this product/i)
      assert.match(err.message, /price/)
      assert.doesNotMatch(err.message, /nothing in the store was updated/i, 'never claims nothing was saved')
      assert.equal(err.saved, stored, 'the row now in the store travels with the error')
      return true
    },
  )
})

test('assertSaved still refuses a write that returned no row at all', () => {
  assert.throws(() => assertSaved(null, payload()), /Nothing was saved/)
})

test('the dashboard closes the editor once a row has landed, so it cannot be added twice', () => {
  const dash = readFileSync(new URL('../src/admin/Dashboard.jsx', import.meta.url), 'utf8')
  const save = dash.slice(dash.indexOf('const handleSave'), dash.indexOf('const confirmCopy'))
  assert.match(save, /if \(e\?\.saved\) applyRow\(e\.saved\)/, 'the landed row is shown')
  assert.match(save, /\(e\?\.saved \? 1 : 0\)/, 'and counted as landed')
  assert.match(save, /if \(!landed\) throw e/, 'so the editor only stays open when nothing landed')
})
