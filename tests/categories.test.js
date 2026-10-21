// Client-editable categories (src/lib/categoryRules.js, src/admin/CategoryManager.jsx
// and supabase/migrations/20261019130000_client_editable_categories.sql).
//
// These rules are what keep a category safe to manage without touching a
// product: the key is derived from the label, duplicates are refused before
// any write, a rename only ever changes the label, and a delete is refused
// while products still point at the category.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  CATEGORY_KEY_RE,
  SEED_CATEGORIES,
  categoriesFromDatabase,
  categoryKey,
  categoryLabelKey,
  cleanLabel,
  findDuplicate,
  mergeCategories,
  typeLabelOf,
  withTypeOption,
} from '../src/lib/categoryRules.js'
import { TYPES, typeLabel } from '../src/data/products.js'

// ---------------------------------------------------------------------------
// The seed is the list the store shipped with — nothing may drift.
// ---------------------------------------------------------------------------

test('the seed is the six categories the client asked for, in order, with their exact labels', () => {
  assert.deepEqual(
    SEED_CATEGORIES.map((c) => [c.key, c.label]),
    [
      ['tops', 'Tops & T-shirts'],
      ['coord', 'Co-ord Sets'],
      ['dress', 'Dresses'],
      ['trousers', 'Trousers & Pants'],
      ['night-wear', 'Night Wear'],
      ['kurta-sets', 'Kurta Sets'],
    ],
  )
  assert.deepEqual(SEED_CATEGORIES.map((c) => c.position), [0, 1, 2, 3, 4, 5])
})

test('the seed matches the bundled TYPES, so the fallback store cannot disagree with the shop', () => {
  assert.equal(SEED_CATEGORIES.length, TYPES.length)
  for (let i = 0; i < TYPES.length; i += 1) {
    assert.equal(SEED_CATEGORIES[i].key, TYPES[i].key)
    assert.equal(SEED_CATEGORIES[i].label, TYPES[i].label)
    assert.equal(typeLabelOf(SEED_CATEGORIES, TYPES[i].key), typeLabel(TYPES[i].key))
  }
})

test('every seeded key satisfies the database key format', () => {
  for (const c of SEED_CATEGORIES) assert.match(c.key, CATEGORY_KEY_RE)
})

// ---------------------------------------------------------------------------
// categoryKey — what a typed name becomes
// ---------------------------------------------------------------------------

test('categoryKey derives a lowercase slug a client never has to see', () => {
  assert.equal(categoryKey('Kurtis'), 'kurtis')
  assert.equal(categoryKey('  Sarees  '), 'sarees')
  assert.equal(categoryKey('Winter Wear'), 'winter-wear')
  assert.equal(categoryKey('Trousers & Pants'), 'trousers-pants')
  assert.equal(categoryKey('Tops & T-shirts'), 'tops-t-shirts')
  assert.equal(categoryKey('2-in-1 sets'), '2-in-1-sets')
})

test('categoryKey folds case and edge spacing, so "KURTIS" and " kurtis " are one category', () => {
  const keys = ['KURTIS', 'kurtis', ' kurtis ', 'Kurtis'].map(categoryKey)
  assert.deepEqual(keys, ['kurtis', 'kurtis', 'kurtis', 'kurtis'])
  assert.equal(new Set(keys).size, 1)
  // A space INSIDE the name is a real word break, not an artefact of spacing,
  // so it becomes a hyphen and a different category.
  assert.equal(categoryKey('Kur tis'), 'kur-tis')
})

test('categoryKey refuses a name with nothing usable in it', () => {
  assert.equal(categoryKey(''), '')
  assert.equal(categoryKey('   '), '')
  assert.equal(categoryKey('!!!'), '')
  assert.equal(categoryKey(' & '), '')
  assert.equal(categoryKey(null), '')
  assert.equal(categoryKey(undefined), '')
})

test('categoryKey never returns a key the database would reject', () => {
  const names = ['Kurtis', 'Winter Wear', 'A'.repeat(120), '  Lead space', 'Trail space  ', 'Em—dash', 'Ünicode']
  for (const name of names) {
    const key = categoryKey(name)
    if (key) assert.match(key, CATEGORY_KEY_RE, `"${name}" produced "${key}"`)
  }
})

test('categoryKey caps the key at the column length without leaving a trailing dash', () => {
  const key = categoryKey('x'.repeat(200) + ' end')
  assert.ok(key.length <= 39, `length was ${key.length}`)
  assert.ok(!key.endsWith('-'), `ended with a dash: ${key}`)
  assert.match(key, CATEGORY_KEY_RE)
})

// ---------------------------------------------------------------------------
// cleanLabel / categoryLabelKey — how the store stores and compares a name
// ---------------------------------------------------------------------------

test('cleanLabel collapses internal runs of space and trims the edges', () => {
  assert.equal(cleanLabel('  Winter    Wear  '), 'Winter Wear')
  assert.equal(cleanLabel('Tops\t&\n Pants'), 'Tops & Pants')
  assert.equal(cleanLabel(null), '')
})

test('cleanLabel caps at the column length the database enforces', () => {
  assert.equal(cleanLabel('a'.repeat(200)).length, 60)
  assert.equal(cleanLabel('a'.repeat(59)).length, 59)
})

test('categoryLabelKey makes case and spacing irrelevant to "is this the same name?"', () => {
  assert.equal(categoryLabelKey('Kurtis'), categoryLabelKey('  kurtis  '))
  assert.equal(categoryLabelKey('Winter Wear'), categoryLabelKey('winter   wear'))
})

// ---------------------------------------------------------------------------
// findDuplicate — the guard that refuses a second copy of a category
// ---------------------------------------------------------------------------

const LIST = [
  { key: 'tops', label: 'Tops & T-shirts', position: 0 },
  { key: 'coord', label: 'Co-ord Sets', position: 1 },
  { key: 'dress', label: 'Dresses', position: 2 },
  { key: 'trousers', label: 'Trousers & Pants', position: 3 },
]

test('a second "Tops & T-shirts" is refused however it is typed', () => {
  assert.equal(findDuplicate(LIST, 'tops & t-shirts')?.key, 'tops')
  assert.equal(findDuplicate(LIST, '  TOPS & T-SHIRTS  ')?.key, 'tops')
  assert.equal(findDuplicate(LIST, 'Tops & T - Shirts')?.key, 'tops')
})

test('a name that only differs by hyphenation is still refused as a duplicate', () => {
  // Both would slug to the same key, so both are "Winter Wear" to a shopper —
  // which means a category cannot be RENAMED to its own current name in a
  // different shape either (the row is skipped by key, so that case is safe).
  assert.equal(findDuplicate([{ key: 'winter-wear', label: 'Winter Wear', position: 0 }], 'Winter Wear')?.key, 'winter-wear')
  assert.equal(findDuplicate([{ key: 'winter-wear', label: 'Winter Wear', position: 0 }], 'winter wear')?.key, 'winter-wear')
  assert.equal(findDuplicate([{ key: 'winter-wear', label: 'Winter Wear', position: 0 }], 'Winter-Wear')?.key, 'winter-wear')
  // Renaming the category to the name it already carries is not a clash with
  // a DIFFERENT category, so it is allowed.
  assert.equal(findDuplicate([{ key: 'winter-wear', label: 'Winter Wear', position: 0 }], 'Winter Wear', 'winter-wear'), null)
})

test('a name made only of punctuation cannot become a category of hyphens', () => {
  // "&" is not spelled out, so it collapses with the other punctuation into
  // nothing at all rather than into a category named "and".
  assert.equal(categoryKey('&'), '')
  assert.equal(categoryKey('  &  '), '')
  assert.equal(categoryKey('---'), '')
  // "and" typed out does produce a key, because it is a real word by itself.
  assert.equal(categoryKey('and'), 'and')
})

test('a genuinely new name finds no duplicate', () => {
  assert.equal(findDuplicate(LIST, 'Kurtis'), null)
  assert.equal(findDuplicate(LIST, 'Winter Wear'), null)
})

test('renaming a category does not collide with its own current label', () => {
  assert.equal(findDuplicate(LIST, 'Tops & T-shirts', 'tops'), null)
  assert.equal(findDuplicate(LIST, 'Dresses', 'dress'), null)
})

test('renaming into a label another category already uses is refused', () => {
  assert.equal(findDuplicate(LIST, 'Dresses', 'tops')?.key, 'dress')
})

test('an empty label is never treated as a duplicate', () => {
  assert.equal(findDuplicate(LIST, ''), null)
  assert.equal(findDuplicate(LIST, '   '), null)
})

// ---------------------------------------------------------------------------
// typeLabelOf — what a product page, breadcrumb and search box call a type
// ---------------------------------------------------------------------------

test('typeLabelOf returns the client label, and the key when it has no answer', () => {
  assert.equal(typeLabelOf(LIST, 'trousers'), 'Trousers & Pants')
  assert.equal(typeLabelOf(LIST, 'unknown-key'), 'unknown-key')
  assert.equal(typeLabelOf([], 'tops'), 'tops')
  assert.equal(typeLabelOf(null, 'tops'), 'tops')
})

// ---------------------------------------------------------------------------
// mergeCategories — one list from the database and the seed
// ---------------------------------------------------------------------------

test('an empty database answer still yields the four seeded categories', () => {
  assert.deepEqual(mergeCategories([]), SEED_CATEGORIES)
  assert.deepEqual(mergeCategories(null), SEED_CATEGORIES)
  assert.deepEqual(mergeCategories(undefined), SEED_CATEGORIES)
})

test('a full database answer wins over the seed and is not doubled up', () => {
  const fromDb = LIST.map((c) => ({ ...c, label: `${c.label}!` }))
  const merged = mergeCategories(fromDb)
  assert.equal(merged.length, SEED_CATEGORIES.length)
  assert.equal(merged.find((c) => c.key === 'tops').label, 'Tops & T-shirts!')
})

test('a category the database has is added to the seed without losing any', () => {
  const merged = mergeCategories([{ key: 'kurtis', label: 'Kurtis', position: 4 }])
  // "kurtis" sits at position 4, where Night Wear also sits, and the
  // database's own answer comes first in a tie — so it leads them.
  assert.deepEqual(merged.map((c) => c.key), ['tops', 'coord', 'dress', 'trousers', 'kurtis', 'night-wear', 'kurta-sets'])
})

test('"Trousers & Pants" survives every merge untouched', () => {
  const merged = mergeCategories([{ key: 'kurtis', label: 'Kurtis', position: 4 }])
  assert.ok(merged.some((c) => c.key === 'trousers' && c.label === 'Trousers & Pants'))
  assert.deepEqual(mergeCategories(LIST), SEED_CATEGORIES)
})

test('merging is ordered by position, seed order breaking ties', () => {
  const merged = mergeCategories([
    { key: 'kurtis', label: 'Kurtis', position: -1 },
    { key: 'shawls', label: 'Shawls', position: 10 },
  ])
  assert.deepEqual(merged.map((c) => c.key), ['kurtis', ...SEED_CATEGORIES.map((c) => c.key), 'shawls'])
})

test('a malformed database row is ignored rather than blanking the storefront', () => {
  const merged = mergeCategories([
    { key: 'BAD KEY', label: 'Nope', position: 0 },
    { key: '', label: 'Nope', position: 1 },
    { label: 'No key at all', position: 2 },
    { key: 'kurtis', label: 'Kurtis', position: 3 },
  ])
  assert.ok(merged.length >= SEED_CATEGORIES.length)
  assert.ok(merged.some((c) => c.key === 'kurtis'))
  for (const c of merged) assert.match(c.key, CATEGORY_KEY_RE)
})

// ---------------------------------------------------------------------------
// categoriesFromDatabase — what the storefront shows when the database has
// answered.
//
// The database is the truth on its own: a category the owner has deleted in
// the admin panel must not still be offered by the storefront, and a filter
// that offers a category the shop has taken away opens a page with nothing
// on it. The seed is only for a database that could not be reached.
// ---------------------------------------------------------------------------

test('a category the owner has deleted is not offered by the storefront', () => {
  const fromDb = [
    { key: 'tops', label: 'Tops & T-shirts', position: 0 },
    { key: 'coord', label: 'Co-ord Sets', position: 1 },
    { key: 'dress', label: 'Dresses', position: 2 },
    { key: 'trousers', label: 'Trousers & Pants', position: 3 },
    { key: 'winter-wear', label: 'Winter Wear', position: 6 },
  ]
  const shown = categoriesFromDatabase(fromDb)
  assert.deepEqual(shown.map((c) => c.key), ['tops', 'coord', 'dress', 'trousers', 'winter-wear'])
  // The two the client asked for by name, and the shop does not stock, are
  // not offered until the owner creates them.
  assert.ok(!shown.some((c) => c.key === 'night-wear'))
  assert.ok(!shown.some((c) => c.key === 'kurta-sets'))
})

test('the seed does not come back when the database has answered', () => {
  // "Night Wear" and "Kurta Sets" are in the seed, and are NOT in this
  // answer: they must stay out of the storefront.
  const shown = categoriesFromDatabase([
    { key: 'tops', label: 'Tops & T-shirts', position: 0 },
    { key: 'night-wear', label: 'Night Wear Renamed By The Owner', position: 1 },
  ])
  assert.deepEqual(shown.map((c) => c.label), ['Tops & T-shirts', 'Night Wear Renamed By The Owner'])
})

test('a category the owner has just added is offered straight away', () => {
  const shown = categoriesFromDatabase([
    { key: 'tops', label: 'Tops & T-shirts', position: 0 },
    { key: 'kurtis', label: 'Kurtis', position: 1, code: '07' },
  ])
  assert.deepEqual(shown.map((c) => c.key), ['tops', 'kurtis'])
  assert.equal(shown[1].code, '07')
})

test('an empty or broken answer yields nothing, so the caller can use the seed', () => {
  assert.deepEqual(categoriesFromDatabase([]), [])
  assert.deepEqual(categoriesFromDatabase(null), [])
  assert.deepEqual(categoriesFromDatabase(undefined), [])
  // A row that cannot be matched is dropped, exactly as mergeCategories does.
  assert.deepEqual(categoriesFromDatabase([{ key: 'BAD KEY', label: 'Nope' }]), [])
})

test('the storefront asks for the database\'s own list, not a merged one', async () => {
  // The bug this pins: the storefront used to merge the seed into every
  // answer, so a category deleted in the admin panel was still offered and
  // opened an empty page.
  const source = await readFile(new URL('../src/lib/categories.js', import.meta.url), 'utf8')
  assert.match(source, /categoriesFromDatabase\(data \|\| \[\]\)/,
    'a successful read is used on its own')
  assert.doesNotMatch(source, /mergeCategories\(data \|\| \[\]\)/,
    'and the seed is not merged into it')
})

// ---------------------------------------------------------------------------
// withTypeOption — a product must never outlive its own picker.
//
// `mergeCategories` drops a row it cannot match, so a product can carry a
// type the list no longer offers. Left out of the <select> that type would
// vanish from the picker, and a client saving such a product would silently
// reassign it to whichever category the browser happened to show first.
// ---------------------------------------------------------------------------

test('withTypeOption adds the type a product carries when the list does not offer it', () => {
  const options = withTypeOption(LIST, 'legacy')
  assert.equal(options.length, LIST.length + 1)
  assert.equal(options.at(-1).key, 'legacy')
  // Named by its key, which is what the rest of the store shows for a
  // category it has no label for.
  assert.equal(options.at(-1).label, 'legacy')
})

test('withTypeOption leaves a list already offering the type completely alone', () => {
  assert.equal(withTypeOption(LIST, 'tops'), LIST)
  assert.equal(withTypeOption(LIST, 'trousers'), LIST)
  assert.equal(withTypeOption(LIST, ''), LIST)
  assert.equal(withTypeOption(LIST, null), LIST)
  assert.equal(withTypeOption(LIST, undefined), LIST)
})

test('withTypeOption never reorders or rewrites the list it is given', () => {
  const options = withTypeOption(LIST, 'legacy')
  assert.deepEqual(options.slice(0, LIST.length), LIST)
  assert.equal(options[0].key, 'tops')
  assert.equal(options[0].label, 'Tops & T-shirts')
})

test('withTypeOption copes with a missing list', () => {
  assert.equal(withTypeOption(null, 'legacy').length, 1)
  assert.equal(withTypeOption(undefined, '').length, 0)
})

test('a duplicate by label the database somehow holds is dropped, never shown twice', () => {
  // A row carrying the seed's label under a different key — what the
  // migration's unique index refuses, so reaching this test means a row
  // written outside the app. The storefront still shows the name once.
  const merged = mergeCategories([
    { key: 'tops-again', label: '  TOPS & T-SHIRTS ', position: 0 },
    { key: 'kurtis', label: 'Kurtis', position: 1 },
  ])
  assert.equal(merged.filter((c) => categoryLabelKey(c.label) === categoryLabelKey('Tops & T-shirts')).length, 1)
  // The database row comes first in the list, so it is the one that survives.
  assert.equal(merged.find((c) => categoryLabelKey(c.label) === categoryLabelKey('Tops & T-shirts')).key, 'tops-again')
})

test('two database rows that differ only by case never both reach the storefront', () => {
  const merged = mergeCategories([
    { key: 'kurtis', label: 'Kurtis', position: 0 },
    { key: 'kurtis-2', label: ' kurtis ', position: 1 },
  ])
  assert.equal(merged.filter((c) => categoryLabelKey(c.label) === 'kurtis').length, 1)
})

test('a non-array answer cannot crash the storefront', () => {
  for (const junk of ['tops', 42, { key: 'x' }, true]) {
    assert.ok(Array.isArray(mergeCategories(junk)))
  }
})

// ---------------------------------------------------------------------------
// The migration behind it — the database half of the same rules.
// ---------------------------------------------------------------------------

const SQL_FILE = new URL('../supabase/migrations/20261019130000_client_editable_categories.sql', import.meta.url)

test('the migrations exist and seed every category with its current label', async () => {
  const sql = await readFile(SQL_FILE, 'utf8')
  for (const [key, label] of SEED_CATEGORIES.slice(0, 4).map((c) => [c.key, c.label])) {
    assert.ok(sql.includes(`'${key}'`), `seeds the ${key} key`)
    assert.ok(sql.includes(`'${label}'`), `seeds the ${label} label`)
  }
  // The three originals plus trousers must all still be present verbatim.
  assert.ok(sql.includes(`'Trousers & Pants'`), 'Trousers & Pants is preserved')

  // The two the client asked for by name come from their own migration.
  const added = await readFile(
    new URL('../supabase/migrations/20261020200000_night_wear_and_kurta_sets.sql', import.meta.url),
    'utf8',
  )
  for (const [key, label] of SEED_CATEGORIES.slice(4).map((c) => [c.key, c.label])) {
    assert.ok(added.includes(`'${key}'`), `seeds the ${key} key`)
    assert.ok(added.includes(`'${label}'`), `seeds the ${label} label`)
  }
})

test('the categories table is public to read and admin-only to write', async () => {
  const sql = await readFile(SQL_FILE, 'utf8')
  assert.ok(sql.includes('create table if not exists public.categories'), 'creates the table')
  assert.ok(sql.includes('alter table public.categories enable row level security'), 'enables RLS')
  assert.match(sql, /on public\.categories for select\s+using \(true\)/, 'the storefront can read it')
  const writes = sql.match(/on public\.categories for (insert|update|delete)[\s\S]{0,400}?is_admin\(\)/g) || []
  assert.equal(writes.length, 3, 'all three write policies are gated on is_admin()')
})

test('the migration backfills every existing type and then forbids an orphan either way', async () => {
  const sql = await readFile(SQL_FILE, 'utf8')
  assert.match(sql, /select distinct p\.type/, 'every type a product already carries becomes a row')
  // Unqualified on purpose: an `ON CONFLICT (key)` target forces an index
  // probe, which Row Level Security can block and which would then fail the
  // whole migration. Every other migration here seeds this way.
  assert.equal(
    sql.match(/on conflict \([a-z]+\) do nothing/g),
    null,
    'no named conflict target — RLS can block the index probe it needs',
  )
  assert.equal(
    (sql.match(/^on conflict do nothing;$/gm) || []).length,
    2,
    'both seed statements are conflict-safe and re-runnable',
  )
  assert.match(sql, /foreign key \(type\) references public\.categories \(key\)/, 'products.type points at the table')
  assert.match(sql, /on delete restrict/, 'a category in use cannot be deleted')
  assert.match(sql, /on update restrict/, 'a key is never rewritten out from under its products')
})

test('the migration refuses duplicate labels case-insensitively, like the admin UI', async () => {
  const sql = await readFile(SQL_FILE, 'utf8')
  assert.match(sql, /categories_label_case_idx/, 'creates the index')
  assert.ok(sql.includes('lower(btrim(label))'), 'compares case- and space-insensitively')
})

test('the migration replaces the fixed four-value check constraint', async () => {
  const sql = await readFile(SQL_FILE, 'utf8')
  assert.ok(sql.includes('products_type_check'), 'drops the old constraint by column lookup')
  assert.ok(sql.includes('public.products'), 'touches only products.type')
  // It must not rewrite, delete or truncate any product.
  assert.doesNotMatch(sql, /delete from public\.products/i, 'no product rows are removed')
  assert.doesNotMatch(sql, /truncate/i, 'nothing is truncated')
  assert.doesNotMatch(sql, /update public\.products\s/i, 'no product row is written')
})
