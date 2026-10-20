// Automatic six-character product IDs (requirement 8).
//
// The rule lives in supabase/migrations/20261020120000_product_skus.sql and
// runs in the database, so the browser can never mint one. These tests pin
// the parts that must never drift: the format, the immutability of the
// category codes, the persistence of the colour codes, the concurrency
// guards, the 99-product ceiling, and the promise that nothing existing is
// renamed, renumbered or deleted.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const MIG = 'supabase/migrations/20261020120000_product_skus.sql'
const SQL = read(MIG)

test('the SKU migration is additive, and so is every migration after it', () => {
  const files = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations')).sort()
  assert.ok(files.includes('20261020120000_product_skus.sql'), 'the SKU migration is there')
  // Later migrations must not undo it: none of them may touch products.id or
  // the uniqueness of the six-character ID.
  for (const file of files.filter((f) => f > '20261020120000_product_skus.sql')) {
    const later = read(`supabase/migrations/${file}`)
    assert.doesNotMatch(later, /alter column id/i, `${file} never rewrites a product id`)
    assert.doesNotMatch(later, /drop index .*products_sku_key/i, `${file} never drops the ID's uniqueness`)
  }

  assert.doesNotMatch(SQL, /\bDROP\s+TABLE\b/i, 'no table is dropped')
  assert.doesNotMatch(SQL, /\bTRUNCATE\b/i, 'nothing is truncated')
  assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i, 'no row is deleted')
  assert.doesNotMatch(SQL, /\bDROP\s+COLUMN\b/i, 'no column is removed')
  assert.match(SQL, /alter table public\.products\s*\n?\s*add column if not exists sku text/i, 'columns are only ever added')
  assert.match(SQL, /add column if not exists code text/i, 'on both tables')
})

test('the immutable product id is left exactly as it is', () => {
  assert.ok(
    SQL.includes('`products.id` is the public, immutable product id'),
    'the reason is documented',
  )
  assert.ok(
    SQL.includes('unique `products.sku`'),
    'and the sanctioned alternative is the one taken',
  )
  assert.doesNotMatch(SQL, /alter column id/i, 'the primary key is never altered')
  assert.doesNotMatch(SQL, /products_pkey/, 'never dropped or rebuilt')
  assert.doesNotMatch(SQL, /alter table public\.order_items/i, 'the orders tables are not altered at all')
  assert.doesNotMatch(SQL, /from public\.order_items/i, 'nor read from')
})

test('the format is CCPPCL, and the column is unique and compulsory', () => {
  assert.match(SQL, /constraint colour_codes_code_format check \(code ~ '\^\[A-Z\]\{2\}\$'\)/, 'CL is two uppercase letters')
  assert.match(SQL, /create unique index if not exists products_sku_key/, 'no two products can share an ID')
  assert.match(SQL, /where sku is not null/, 'and the uniqueness holds while it is being backfilled')
  assert.match(SQL, /alter column sku set not null/, 'after which every product must have one')
  assert.match(SQL, /lpad\(next_num::text, 2, '0'\)/, 'PP and CC are always two digits')
  assert.match(SQL, /substr\(new\.sku, 3, 2\)/, 'the number really is characters 3–4')
})

test('the ID is minted in the database, for inserts and for the fields that change it', () => {
  assert.match(SQL, /create trigger products_assign_sku\s*\n\s*before insert or update of type, colour, title, sku on public\.products/i)
  assert.match(SQL, /security definer/i, 'so a catalogue manager can save a product without reading the maps directly')
  assert.match(SQL, /set search_path = public, pg_temp/, 'and cannot be hijacked through the search path')
  assert.match(SQL, /new\.sku := cat_code \|\| public\.next_product_number\(cat_code\) \|\| colour_cl/, 'insert path')
  assert.match(SQL, /colour_cl := public\.sku_colour_code\(new\.colour, new\.title\)/, 'a colour change refreshes CL')
})

test('concurrency is guarded: two saves at once cannot mint the same number', () => {
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('ruhi\.collection\.category_code'\)\)/, 'category codes are serialised')
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('ruhi\.collection\.product_sku'\), hashtext\(p_code\)\)/,
    'product numbers are serialised per category')
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('ruhi\.collection\.colour_code'\)\)/, 'colour codes too')
  assert.match(SQL, /p\.sku = wanted and p\.id <> new\.id/, 'an ID somebody else holds is never taken')
})

test('past 99 products in one category it says so instead of writing a broken ID', () => {
  assert.match(SQL, /if next_num > 99 then\s*\n\s*raise exception 'This category already holds 99 products/i)
  assert.match(SQL, /using errcode = 'P0001'/, 'a friendly failure, the same shape checkout uses')
  assert.match(SQL, /remove an unused product or add a new category/i, 'and it says what to do about it')
})

test('category codes are assigned once, in display order, and never renumbered', () => {
  const tops = SQL.indexOf("select key from public.categories where code is null order by position, key")
  assert.ok(tops > 0, 'the backfill walks the categories in the order the store lists them')
  assert.match(SQL, /where code is null order by position/, 'only rows without a code are numbered')
  assert.match(SQL, /if new\.code is null or btrim\(new\.code\) = '' then/, 'the trigger only ever APPLIES a code')
  assert.match(SQL, /A code is only ever APPLIED, never rewritten/, 'and says so')
  assert.ok(
    SQL.includes("update public.categories set code = lpad(next_num::text, 2, '0') where key = row.key"),
    'the one place a code is written down names a single category, so a re-run cannot renumber anything',
  )
  assert.match(SQL, /add column if not exists code text/, 'the mapping is persisted on the category itself')
  assert.match(SQL, /create unique index if not exists categories_code_key/, 'two categories cannot share a code')
})

test('colour codes are persisted, with Blue = BU, Yellow = YE and Red = RE', () => {
  assert.match(SQL, /create table if not exists public\.colour_codes/i)
  assert.match(SQL, /'blue',\s*'Blue',\s*'BU'/)
  assert.match(SQL, /'yellow',\s*'Yellow',\s*'YE'/)
  assert.match(SQL, /'red',\s*'Red',\s*'RE'/)
  assert.match(SQL, /'black',\s*'Black',\s*'BL'/, 'Black keeps the letters Blue would otherwise have taken')
  assert.match(SQL, /the one deliberate letter-pair override/, 'the override is documented')
  assert.match(SQL, /alter table public\.colour_codes enable row level security/, 'a browser cannot write a code')
  assert.doesNotMatch(SQL, /create policy[\s\S]{0,200}colour_codes/i, 'and there is no policy that would let it')
  assert.match(SQL, /on conflict \(colour\) do nothing/, 're-running never rewrites a code')
})

test('a colour that has never been seen is derived, then written down at once', () => {
  assert.match(SQL, /select c\.code into cand from public\.colour_codes c where c\.colour = key/, 'first: what we already know')
  assert.match(SQL, /insert into public\.colour_codes \(colour, label, code\)/, 'then: record the new answer')
  assert.match(SQL, /regexp_replace\(label, '\[\^A-Za-z\]', '', 'g'\)/, 'so "Royal Blue" and "Royalblue" are one colour')
  assert.match(SQL, /return 'XX'/, 'a missing colour gets the documented placeholder')
  assert.match(SQL, /explicitly and safely "no colour recorded"/i, 'rather than an invented code')
})

test('the backfill is ordered, minimal and cannot re-run', () => {
  assert.match(SQL, /where p\.sku is null\s*\n\s*order by p\.created_at, p\.id/, 'oldest first, once, and only unnumbered rows')
  assert.match(SQL, /set sku = cat_code \|\| lpad\(next_num::text, 2, '0'\)/, 'it writes the sku and nothing else')
  const backfillBlock = SQL.slice(SQL.indexOf('-- 6. Backfill'))
  assert.doesNotMatch(backfillBlock, /set (?!sku)[a-z_]+ =/, 'no other column is ever written')
})

// ---- what the admin sees ----------------------------------------------------

test('the admin is shown the SKU and never asked to type one', () => {
  const list = read('src/admin/ProductList.jsx')
  assert.match(list, /\{p\.sku \|\| p\.id\}/, 'the product row shows the six-character ID')
  assert.match(list, /\{r\.sku \|\| r\.id\}/, 'and so does each colour row')

  const editor = read('src/admin/ProductEditor.jsx')
  assert.doesNotMatch(editor, /sku/i, 'the editor has no SKU field to fill in')

  const form = read('src/lib/productForm.js')
  assert.match(form, /const id = uniqueId\(slug\(buildTitle\(shared\.name, v\.colour\)\), taken\)/,
    'the internal id is still derived automatically when it is not typed')
})

test('the storefront carries the SKU, and it is searchable', () => {
  const ctx = read('src/context/ProductsContext.jsx')
  assert.match(ctx, /sku: r\.sku \|\| ''/, 'read straight off the row')
  assert.match(read('src/lib/productSearch.js'), /p\.sku/, 'searchable by its ID')
  const dash = read('src/admin/Dashboard.jsx')
  assert.match(dash, /r\.sku/, 'and findable in the dashboard search box')
})

test('nothing existing was renamed to make room', () => {
  assert.doesNotMatch(SQL, /update public\.products\s*\n?\s*set id/i, 'no product id is rewritten')
  assert.doesNotMatch(SQL, /\bprice\b\s*=/i, 'no price is touched')
  assert.doesNotMatch(SQL, /is_active\s*=/i, 'no product is hidden or shown')
  assert.match(SQL, /Nothing else about a row is written/,
    'the promise is written down where the next maintainer will read it')
})
