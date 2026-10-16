// The pure logic behind the admin product editor: how a stored row loads into
// the form, how the form turns into database writes, and the validation that
// stands between the two. Run with `npm test` (node --test).
//
// The promises these tests pin down:
//   - a stored colour can never be lost by opening and saving a product;
//   - a save writes only what really changed, so one colour's edit can never
//     overwrite another colour's data;
//   - new colours get unique IDs derived from name + colour, and existing
//     IDs are never rewritten.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blankVariant, buildPlan, buildTitle, colourOf, createPayload, galleryOf,
  groupForm, nameOf, sharedFromRow, slug, uniqueId, updatePayload, validateForm,
  withIds,
} from '../src/lib/productForm.js'

const row = (id, title, extra = {}) => ({
  id,
  title,
  type: 'tops',
  price: 900,
  compare: null,
  rating: 0,
  reviews: 0,
  badge: null,
  sizes: ['S', 'M', 'L', 'XL'],
  desc: '',
  image: `/images/products/${id}.jpg`,
  hover: '',
  is_active: true,
  colour: null,
  ...extra,
})

// ---- colour round-trip -----------------------------------------------------

test('an existing colour loads into the field and saves back unchanged', () => {
  const r = row('denim-shirt-black', 'Denim Shirt - Black')
  assert.equal(colourOf(r), 'Black')
  assert.equal(nameOf(r), 'Denim Shirt')
  assert.equal(buildTitle(nameOf(r), colourOf(r)), 'Denim Shirt - Black', 'the title survives a round trip byte for byte')
})

test('the colour column wins, and a colourless title stays colourless', () => {
  assert.equal(colourOf(row('a', 'Classic Shirt - Blue', { colour: 'Wine Red' })), 'Wine Red')
  const plain = row('denim-dress', 'Denim Dress')
  assert.equal(colourOf(plain), '')
  assert.equal(nameOf(plain), 'Denim Dress')
  assert.equal(buildTitle(nameOf(plain), colourOf(plain)), 'Denim Dress')
})

test('a title without the " - " separator round-trips exactly', () => {
  const r = row('korean-pants-biege-jpg', 'Korean Pants- Biege')
  assert.equal(colourOf(r), '')
  assert.equal(nameOf(r), 'Korean Pants- Biege')
  assert.equal(buildTitle(nameOf(r), colourOf(r)), 'Korean Pants- Biege')
})

test('a novel colour stored only in the title round-trips and can be typed', () => {
  const r = row('tshirt-lavender', 'Tshirt - Lavender')
  assert.equal(colourOf(r), 'Lavender', 'any saved suffix loads — never cleared on edit')
  assert.equal(nameOf(r), 'Tshirt')
  assert.equal(buildTitle('Tshirt', 'Lavender'), 'Tshirt - Lavender')
})

test('slug and title building follow the editor’s historical rules', () => {
  assert.equal(slug('Denim Shirt - Black'), 'denim-shirt-black')
  assert.equal(slug('  '), '')
  assert.equal(buildTitle('Classic Shirt', '  '), 'Classic Shirt')
  assert.equal(buildTitle('Classic Shirt', 'Beige'), 'Classic Shirt - Beige')
})

// ---- form loading ----------------------------------------------------------

test('groupForm loads the shared section from the lead colour', () => {
  const rows = [
    row('denim-shirt-black', 'Denim Shirt - Black', { desc: 'Soft denim.', rating: '4.5', reviews: 12 }),
    row('denim-shirt-blue', 'Denim Shirt - Blue'),
  ]
  const form = groupForm(rows, 'coord')

  assert.equal(form.shared.name, 'Denim Shirt')
  assert.equal(form.shared.type, 'tops')
  assert.equal(form.shared.desc, 'Soft denim.')
  assert.equal(form.shared.rating, '4.5')
  assert.equal(form.variants.length, 2)
  assert.equal(form.variants[0].colour, 'Black')
  assert.equal(form.variants[0].id, 'denim-shirt-black')
  assert.equal(form.variants[1].colour, 'Blue')
  assert.equal(form.variants[1].idTouched, true, 'existing IDs are locked')
})

test('groupForm starts a brand-new product with one empty colour', () => {
  const form = groupForm([], 'trousers')
  assert.equal(form.shared.type, 'trousers')
  assert.equal(form.variants.length, 1)
  assert.equal(form.variants[0].colour, '')
  assert.equal(form.variants[0].original, null)
})

// ---- ids -------------------------------------------------------------------

test('new colours get unique ids derived from name and colour', () => {
  const taken = new Set(['classic-shirt-black-2'])
  const variants = [
    { ...blankVariant('a'), colour: 'Black' },
    { ...blankVariant('b'), colour: 'Black - 2' }, // slug collides after sanitising
  ]
  const ids = withIds({ name: 'Classic Shirt' }, variants, taken).map((v) => v.id)
  assert.equal(ids[0], 'classic-shirt-black')
  assert.equal(ids[1], 'classic-shirt-black-2-2', 'never collides with the database or another colour')
})

test('existing and manually chosen ids are never rewritten', () => {
  const existing = row('denim-shirt-black', 'Denim Shirt - Black')
  const variants = [
    { ...blankVariant('a'), original: existing, id: 'denim-shirt-black' },
    { ...blankVariant('b'), colour: 'Blue', id: 'my-own-id', idTouched: true },
    { ...blankVariant('c'), colour: 'Red' },
  ]
  const out = withIds({ name: 'Denim Shirt' }, variants, ['denim-shirt-black'])
  assert.equal(out[0].id, 'denim-shirt-black')
  assert.equal(out[1].id, 'my-own-id')
  assert.equal(out[2].id, 'denim-shirt-red')
})

test('uniqueId suffixes until free', () => {
  assert.equal(uniqueId('a', new Set()), 'a')
  assert.equal(uniqueId('a', new Set(['a'])), 'a-2')
  assert.equal(uniqueId('a', new Set(['a', 'a-2'])), 'a-3')
})

// ---- payloads --------------------------------------------------------------

test('createPayload carries every column a new colour needs', () => {
  const shared = { name: 'Classic Shirt', type: 'tops', desc: 'Nice.', sizes: ['S', 'M'], badge: 'New', rating: 4.2, reviews: 7 }
  const v = { ...blankVariant('a'), id: 'classic-shirt-wine-red', colour: 'Wine Red', price: '950', compare: '1050', image: '/i.jpg', hover: '/h.jpg' }
  const p = createPayload(shared, v)

  assert.deepEqual(p, {
    id: 'classic-shirt-wine-red',
    title: 'Classic Shirt - Wine Red',
    type: 'tops',
    price: 950,
    compare: 1050,
    rating: 4.2,
    reviews: 7,
    badge: 'New',
    sizes: ['S', 'M'],
    description: 'Nice.',
    image: '/i.jpg',
    hover: '/h.jpg',
    colour: 'Wine Red',
    is_active: true,
  })
})

test('the gallery is only written when a photo changed (extras preserved otherwise)', () => {
  const shared = { name: 'X', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const untouched = { ...blankVariant('a'), id: 'x-black', colour: 'Black', image: '/a.jpg', hover: '/b.jpg' }
  assert.equal('gallery' in createPayload(shared, untouched), false)

  const touched = { ...untouched, galleryDirty: true, image: '/new.jpg' }
  assert.deepEqual(createPayload(shared, touched).gallery, ['/new.jpg', '/b.jpg'])
  assert.deepEqual(galleryOf({ image: '', hover: '' }), [], 'no photos, no gallery')
})

test('updatePayload writes only the columns that really changed', () => {
  const lead = row('denim-shirt-black', 'Denim Shirt - Black', { colour: 'Black' })
  // The form is loaded exactly as the editor loads it, so the row's own images
  // and colour are in the field state.
  const [variant] = groupForm([lead], 'tops').variants
  const payload = updatePayload(sharedFromRow(lead), { price: 1010 }, { ...variant, price: '1010' })

  assert.deepEqual(payload, { id: 'denim-shirt-black', price: 1010 })
  assert.equal('colour' in payload, false, 'an untouched colour is never sent — and so never cleared')
  assert.equal('image' in payload, false, 'the photos the form was opened with are not rewritten')
})

test('a row from before the colour column gets its colour stored on first save', () => {
  const legacy = row('tshirt-lavender', 'Tshirt - Lavender') // colour only in the title
  const [variant] = groupForm([legacy], 'tops').variants
  const payload = updatePayload(sharedFromRow(legacy), {}, variant)
  assert.deepEqual(payload, { id: 'tshirt-lavender', colour: 'Lavender' }, 'title untouched, colour made explicit')
})

// ---- plans -----------------------------------------------------------------

const group = () => {
  // Rows as the migration leaves them: the colour both in the title and in the
  // `colour` column.
  const black = row('denim-shirt-black', 'Denim Shirt - Black', { desc: 'Shared.', price: 900, colour: 'Black' })
  const blue = row('denim-shirt-blue', 'Denim Shirt - Blue', { desc: 'Shared.', price: 900, colour: 'Blue' })
  const form = groupForm([black, blue], 'tops')
  return { black, blue, form, lead: black }
}

test('an untouched product saves as no writes at all', () => {
  const { form, lead } = group()
  const plan = buildPlan({ shared: form.shared, variants: form.variants, takenIds: [lead.id, 'denim-shirt-blue'], lead })
  assert.deepEqual(plan, { creates: [], updates: [], deletes: [] })
})

test('editing one colour’s price touches only that colour’s row', () => {
  const { form, lead, blue } = group()
  const variants = form.variants.map((v) => (v.id === blue.id ? { ...v, price: '850' } : v))
  const plan = buildPlan({ shared: form.shared, variants, takenIds: [lead.id, blue.id], lead })

  assert.deepEqual(plan.updates, [{ id: blue.id, payload: { id: blue.id, price: 850 } }])
  assert.equal(plan.creates.length, 0)
  assert.equal(plan.deletes.length, 0)
})

test('renaming the product retitles every colour but never touches their ids', () => {
  const { form, lead, black, blue } = group()
  const plan = buildPlan({ shared: { ...form.shared, name: 'Denim Overshirt' }, variants: form.variants, takenIds: [black.id, blue.id], lead })

  assert.deepEqual(plan.updates.map((u) => u.payload.title), ['Denim Overshirt - Black', 'Denim Overshirt - Blue'])
  assert.deepEqual(plan.updates.map((u) => u.id), [black.id, blue.id], 'URLs keep working')
})

test('a shared field only travels when the parent actually changed it', () => {
  const black = row('denim-shirt-black', 'Denim Shirt - Black', { desc: 'Shared.', colour: 'Black' })
  const blue = row('denim-shirt-blue', 'Denim Shirt - Blue', { desc: 'A different note only blue ever had.', colour: 'Blue' })
  const form = groupForm([black, blue], 'tops')

  // The parent edits only the description…
  const plan = buildPlan({
    shared: { ...form.shared, desc: 'Brand new copy.' },
    variants: form.variants,
    takenIds: [black.id, blue.id],
    lead: black,
  })
  const byId = Object.fromEntries(plan.updates.map((u) => [u.id, u.payload]))
  assert.equal(byId[black.id].description, 'Brand new copy.')
  assert.equal(byId[blue.id].description, 'Brand new copy.', 'the whole design gets the new copy')

  // …but when the parent edits nothing, blue’s divergent note survives.
  const untouched = buildPlan({ shared: form.shared, variants: form.variants, takenIds: [black.id, blue.id], lead: black })
  assert.equal(untouched.updates.length, 0)
})

test('adding and removing colours becomes one insert and one delete', () => {
  const { form, lead, black, blue } = group()
  const variants = [
    form.variants[0],
    { ...form.variants[1], removed: true },
    { ...blankVariant('new'), colour: 'Wine Red', price: '990' },
  ]
  const plan = buildPlan({ shared: form.shared, variants, takenIds: [black.id, blue.id], lead })

  assert.deepEqual(plan.deletes, [blue.id], 'only the removed colour’s row is deleted')
  assert.deepEqual(plan.creates.map((c) => c.id), ['denim-shirt-wine-red'])
  assert.equal(plan.creates[0].title, 'Denim Shirt - Wine Red')
  assert.equal(plan.updates.length, 0, 'black was not edited')
})

test('removing a colour never deletes the product', () => {
  const { form, lead, black, blue } = group()
  const variants = form.variants.map((v) => ({ ...v, removed: true }))
  const errors = validateForm({ shared: form.shared, variants, takenIds: [black.id, blue.id] })
  assert.ok(errors.some((e) => /at least one colour/i.test(e)), 'and the form refuses to remove the last ones')

  const plan = buildPlan({ shared: form.shared, variants, takenIds: [black.id, blue.id], lead })
  assert.deepEqual(plan, { creates: [], updates: [], deletes: [black.id, blue.id] }, 'the plan only reaches the database after validation passes')
})

// ---- validation ------------------------------------------------------------

test('any colour name is accepted, including ones the storefront list lacks', () => {
  const shared = { name: 'Classic Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const variants = [
    { ...blankVariant('a'), id: 'classic-shirt-pastel-pink', colour: 'Pastel Pink', price: '900' },
    { ...blankVariant('b'), id: 'classic-shirt-mustard-yellow', colour: 'Mustard Yellow', price: '900' },
    { ...blankVariant('c'), id: 'classic-shirt-olive-green', colour: 'Olive Green', price: '900' },
  ]
  assert.deepEqual(validateForm({ shared, variants, takenIds: [] }), [])
})

test('validation blocks duplicates, missing colours, separators and id clashes', () => {
  const shared = { name: 'Classic Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const errs = validateForm({
    shared,
    variants: [
      { ...blankVariant('a'), id: 'classic-shirt-black', colour: 'Black', price: '900' },
      { ...blankVariant('b'), id: 'classic-shirt-black-2', colour: 'black', price: '900' },
      { ...blankVariant('c'), id: 'classic-shirt-grey', colour: 'Grey - Blue', price: '900' },
      { ...blankVariant('d'), id: 'denim-dress', colour: '', price: '900' },
    ],
    takenIds: ['denim-dress'],
  })
  assert.ok(errs.some((e) => /must be different/i.test(e)), 'two colours named “Black”/“black”')
  assert.ok(errs.some((e) => /separates the product/i.test(e)), '“ - ” inside a colour name')
  assert.ok(errs.some((e) => /every colour needs a name/i.test(e)), 'a variant without a colour')
  assert.ok(errs.some((e) => /already used by another product/i.test(e)), 'an id that belongs to another product')
})

test('a single-colour product may leave the colour blank', () => {
  const dress = row('denim-dress', 'Denim Dress', { type: 'dress' })
  const shared = sharedFromRow(dress)
  const variants = [{ ...blankVariant('a'), original: dress, id: 'denim-dress', colour: '', price: '900' }]
  assert.deepEqual(validateForm({ shared, variants, takenIds: ['denim-dress'] }), [], 'its own locked id is not a clash')
})

test('a missing name or price is refused with a readable message', () => {
  const shared = { name: '   ', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const errs = validateForm({ shared, variants: [{ ...blankVariant('a'), id: '', colour: 'Black', price: 'abc' }], takenIds: [] })
  assert.ok(errs.some((e) => /product name/i.test(e)))
  assert.ok(errs.some((e) => /product ID/i.test(e)))
  assert.ok(errs.some((e) => /valid price/i.test(e)))
})
