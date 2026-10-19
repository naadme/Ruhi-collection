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
  blankVariant, buildPlan, buildTitle, colourOf, createPayload, groupForm, MAX_IMAGES_PER_COLOUR,
  nameOf, photosOf, sharedFromRow, SIZE_DEFAULT, SIZE_OPTIONS, slug, toggleSize, uniqueId,
  updatePayload, validateForm, withIds,
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
  const v = { ...blankVariant('a'), id: 'classic-shirt-wine-red', colour: 'Wine Red', price: '950', compare: '1050', photos: ['/i.jpg', '/h.jpg'] }
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

test('the gallery is written when the colour holds more than main + hover, or was touched', () => {
  const shared = { name: 'X', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const untouched = { ...blankVariant('a'), id: 'x-black', colour: 'Black', photos: ['/a.jpg', '/b.jpg'] }
  assert.equal('gallery' in createPayload(shared, untouched), false, 'two classic photos need no gallery column')

  const three = { ...untouched, photos: ['/a.jpg', '/b.jpg', '/c.jpg'] }
  assert.deepEqual(createPayload(shared, three).gallery, ['/a.jpg', '/b.jpg', '/c.jpg'])
  assert.equal(createPayload(shared, three).image, '/a.jpg', 'the first photo is the card image')
  assert.equal(createPayload(shared, three).hover, '/b.jpg', 'the second is the hover image')

  const touched = { ...untouched, galleryDirty: true, photos: ['/new.jpg', '/b.jpg'] }
  assert.deepEqual(createPayload(shared, touched).gallery, ['/new.jpg', '/b.jpg'])
  assert.deepEqual(photosOf({ photos: [] }), [], 'no photos, no gallery')
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

// ---- photos per colour (up to four) ---------------------------------------

test('a stored row loads its gallery photos in order, capped at four', () => {
  const r = row('embroidery-coord-set-beige', 'Embroidery coord set - Beige', {
    image: '/i1.jpg', hover: '/i2.jpg', gallery: ['/i1.jpg', '/i2.jpg', '/i3.jpg', '/i4.jpg', '/i5.jpg'],
  })
  assert.deepEqual(photosOf(r), ['/i1.jpg', '/i2.jpg', '/i3.jpg', '/i4.jpg'])
  const [variant] = groupForm([r], 'coord').variants
  assert.deepEqual(variant.photos, ['/i1.jpg', '/i2.jpg', '/i3.jpg', '/i4.jpg'])
})

test('a row from before the gallery column loads as main + hover', () => {
  const r = row('denim-dress', 'Denim Dress', { image: '/a.jpg', hover: '/b.jpg', gallery: null })
  assert.deepEqual(photosOf(r), ['/a.jpg', '/b.jpg'])
})

test('reordering photos writes image, hover and gallery as one consistent set', () => {
  const lead = row('stripes-dress-blue', 'Stripes Dress - Blue', {
    colour: 'Blue',
    image: '/a.jpg', hover: '/b.jpg', gallery: ['/a.jpg', '/b.jpg', '/c.jpg'],
  })
  const [variant] = groupForm([lead], 'dress').variants
  const payload = updatePayload(sharedFromRow(lead), {}, { ...variant, photos: ['/c.jpg', '/a.jpg', '/b.jpg'] })
  assert.deepEqual(payload, {
    id: 'stripes-dress-blue',
    image: '/c.jpg',
    hover: '/a.jpg',
    gallery: ['/c.jpg', '/a.jpg', '/b.jpg'],
  })
})

test('removing a photo keeps the rest in order and rewrites the set', () => {
  const lead = row('stripes-dress-pink', 'Stripes Dress - Pink', {
    colour: 'Pink',
    image: '/a.jpg', hover: '/b.jpg', gallery: ['/a.jpg', '/b.jpg', '/c.jpg'],
  })
  const [variant] = groupForm([lead], 'dress').variants
  const payload = updatePayload(sharedFromRow(lead), {}, { ...variant, photos: ['/a.jpg', '/c.jpg'] })
  assert.deepEqual(payload, {
    id: 'stripes-dress-pink',
    image: '/a.jpg',
    hover: '/c.jpg',
    gallery: ['/a.jpg', '/c.jpg'],
  })
})

test('one colour’s photos are never written to another colour’s row', () => {
  const blue = row('stripes-dress-blue', 'Stripes Dress - Blue', {
    colour: 'Blue', image: '/b1.jpg', hover: '/b2.jpg', gallery: ['/b1.jpg', '/b2.jpg', '/b3.jpg'],
  })
  const pink = row('stripes-dress-pink', 'Stripes Dress - Pink', {
    colour: 'Pink', image: '/p1.jpg', hover: '/p2.jpg',
  })
  const form = groupForm([blue, pink], 'dress')
  const plan = buildPlan({
    shared: { ...form.shared, name: 'Stripes Dress' },
    variants: form.variants.map((v) => (v.id === pink.id ? { ...v, photos: ['/p1.jpg', '/p2.jpg', '/p3.jpg'] } : v)),
    takenIds: [blue.id, pink.id],
    lead: blue,
  })
  assert.deepEqual(plan.updates.map((u) => u.id), [pink.id], 'only the touched colour is written at all')
  assert.deepEqual(plan.updates[0].payload.gallery, ['/p1.jpg', '/p2.jpg', '/p3.jpg'])
})

test('the editor refuses to save more than four photos for a colour', () => {
  const shared = { name: 'X', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  const photos = ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg']
  const errs = validateForm({
    shared,
    variants: [{ ...blankVariant('a'), id: 'x-black', colour: 'Black', price: '900', photos }],
    takenIds: [],
  })
  assert.ok(errs.some((e) => /up to 4 photos/i.test(e)))
})

test('fewer than four photos is always fine', () => {
  const shared = { name: 'X', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }
  for (const photos of [[], ['/1.jpg'], ['/1.jpg', '/2.jpg'], ['/1.jpg', '/2.jpg', '/3.jpg'], ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg']]) {
    assert.deepEqual(
      validateForm({ shared, variants: [{ ...blankVariant('a'), id: 'x-black', colour: 'Black', price: '900', photos }], takenIds: [] }),
      [],
      `${photos.length} photo(s) save without complaint`,
    )
  }
})

// ---- sizes up to 5XL -------------------------------------------------------

test('the size options run from XS through 5XL, and the default is unchanged', () => {
  assert.deepEqual(SIZE_OPTIONS, ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'])
  // XS was added at the FRONT so every size a product already offers keeps its
  // position in the list — nothing a catalogue row stores today shifts.
  assert.deepEqual(SIZE_DEFAULT, ['S', 'M', 'L', 'XL'], 'existing products keep their sizes')
})

test('every size already stored in production is still a known option', () => {
  // Live catalogue holds S, M, L, XL and XXL (checked against the database
  // when this was written). None of them may become "unknown" and get pushed
  // to the end of the list by an edit.
  const shipped = ['S', 'M', 'L', 'XL', 'XXL']
  for (const size of shipped) {
    assert.ok(SIZE_OPTIONS.includes(size), `${size} must stay a known size`)
  }
  assert.deepEqual(
    toggleSize([...shipped], 'M'),
    ['S', 'L', 'XL', 'XXL'],
    'removing one leaves the rest in canonical order',
  )
})

test('a product may offer only its own subset of sizes', () => {
  let sizes = ['S', 'M', 'L', 'XL']
  sizes = toggleSize(sizes, 'XL')
  sizes = toggleSize(sizes, 'L')
  assert.deepEqual(sizes, ['S', 'M'], 'a product that stops at M is fine')
  sizes = toggleSize(sizes, '5XL')
  assert.deepEqual(sizes, ['S', 'M', '5XL'], 'and one that jumps straight to 5XL is too')
})

test('toggling keeps sizes in canonical order and never drops unknown ones', () => {
  const sizes = toggleSize(['XL', 'S', 'Custom'], 'M')
  assert.deepEqual(sizes, ['S', 'M', 'XL', 'Custom'], 're-added sizes return to their place; unknown sizes survive')
  assert.deepEqual(toggleSize(sizes, 'M'), ['S', 'XL', 'Custom'], 'toggling off removes exactly one')
})

test('the create contract sends the chosen sizes verbatim', () => {
  const shared = { name: 'X', type: 'trousers', desc: '', sizes: ['M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'], badge: '', rating: 0, reviews: 0 }
  const p = createPayload(shared, { ...blankVariant('a'), id: 'x-black', colour: 'Black', price: '900' })
  assert.deepEqual(p.sizes, ['M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'])
})
