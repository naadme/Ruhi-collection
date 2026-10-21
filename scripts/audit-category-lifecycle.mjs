// The category lifecycle, against the LIVE database.
//
//   add → the storefront sees it → a product joins it → the category cannot be
//   deleted out from under that product → the product is removed → the
//   category is deleted → the storefront does not see it any more.
//
// Every row this script creates is removed before it finishes, and the script
// refuses to start if its own test rows are already there (so it can never
// leave a duplicate behind, and can never touch a row that is not its own).
//
// The writes go through the Management API (the service role), which is what
// an admin's own insert amounts to; the READS go through the public API with
// the anonymous key, which is exactly what the storefront does — so "the
// storefront sees it" is proved with the storefront's own credentials.
//
// Usage: node scripts/audit-category-lifecycle.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const REF = 'xhsjwhzutalckeektluj'
const API = `https://${REF}.supabase.co`

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY

const sql = (query) => {
  const out = execFileSync('/tmp/sql.sh', [query], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  if (parsed && parsed.message) throw new Error(parsed.message)
  return Array.isArray(parsed) ? parsed : (parsed[0] || [])
}

const rest = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

const KEY = 'audit-check-category'
const LABEL = 'Audit Check Category'
const PRODUCT_ID = 'audit-check-product'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\nThe category lifecycle, against the live database\n')

// --- 0. nothing of ours may already be there -------------------------------
const existing = sql(`select key, label, code from public.categories where key = '${KEY}'`)
if (existing.length) {
  console.log(`  ✖ “${KEY}” already exists — this script will not touch it.`)
  console.log('    Remove it by hand, then run the script again.')
  process.exit(1)
}
const existingProduct = sql(`select id from public.products where id = '${PRODUCT_ID}'`)
if (existingProduct.length) {
  console.log(`  ✖ “${PRODUCT_ID}” already exists — this script will not touch it.`)
  process.exit(1)
}

let categoryCode = null
try {
  // --- 1. add a category, the way the admin panel does --------------------
  sql(`insert into public.categories (key, label, position)
       values ('${KEY}', '${LABEL}', 99)`)
  const added = sql(`select key, label, position, code from public.categories where key = '${KEY}'`)
  categoryCode = added[0]?.code || null
  check('the category is saved in the database', added.length === 1, added[0]?.label || '')
  check(
    'it is given its own category code without anyone setting it by hand',
    /^[0-9]{2}$/.test(String(categoryCode)) && categoryCode !== '00',
    `code ${categoryCode}`,
  )

  // --- 2. the storefront sees it, with the storefront's own credentials -----
  const seen = await rest('/rest/v1/categories?select=key,label,code&order=position')
  const row = (seen.body || []).find((c) => c.key === KEY)
  check('the storefront reads it straight away', seen.status === 200 && !!row, row ? row.label : 'not found')

  // --- 3. an anonymous visitor cannot create or delete one ----------------
  const anonInsert = await rest('/rest/v1/categories', {
    method: 'POST',
    body: JSON.stringify({ key: 'audit-anon-category', label: 'Audit Anon Category', position: 98 }),
  })
  check(
    'an anonymous visitor cannot create a category',
    anonInsert.status >= 400,
    `the database answered ${anonInsert.status}`,
  )
  const anonDelete = await rest(`/rest/v1/categories?key=eq.${KEY}`, { method: 'DELETE' })
  check('an anonymous visitor cannot delete a category', anonDelete.status >= 400, `the database answered ${anonDelete.status}`)
  const stillThere = sql(`select key from public.categories where key = '${KEY}'`)
  check('the category survived that attempt', stillThere.length === 1)

  // --- 4. a product joins the new category --------------------------------
  sql(`insert into public.products (id, title, type, price, image, colour, is_active)
       values ('${PRODUCT_ID}', 'Audit Check Product', '${KEY}', 499,
               '/images/products/denim-shirt-blue.jpg', 'Blue', true)`)
  const product = sql(`select id, type, sku from public.products where id = '${PRODUCT_ID}'`)
  check('a product can be saved into the new category', product.length === 1, product[0]?.type || '')
  check(
    'the product is given a Product ID built from the new category’s own code',
    String(product[0]?.sku || '').startsWith(String(categoryCode)) && /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(String(product[0]?.sku || '')),
    product[0]?.sku || 'none',
  )

  // --- 5. the category cannot be deleted while the product is there -------
  let refused = null
  try {
    sql(`delete from public.categories where key = '${KEY}'`)
  } catch (e) {
    refused = String(e.message)
  }
  const stillThere2 = sql(`select key from public.categories where key = '${KEY}'`)
  const productStillThere = sql(`select id from public.products where id = '${PRODUCT_ID}'`)
  check(
    'a category with products in it cannot be deleted',
    !!refused && stillThere2.length === 1,
    refused ? refused.split('\n')[0].slice(0, 90) : 'the delete went through!',
  )
  check('and the product is untouched by the refused delete', productStillThere.length === 1)

  // --- 6. the product leaves, then the category can go --------------------
  sql(`delete from public.products where id = '${PRODUCT_ID}'`)
  sql(`delete from public.categories where key = '${KEY}'`)
  const gone = sql(`select key from public.categories where key = '${KEY}'`)
  check('an empty category can be deleted', gone.length === 0)
  const unseen = await rest('/rest/v1/categories?select=key')
  check('the storefront does not see it any more', !(unseen.body || []).some((c) => c.key === KEY))
  const productGone = sql(`select id from public.products where id = '${PRODUCT_ID}'`)
  check('the test product is gone too', productGone.length === 0)
} finally {
  // Whatever happened, the database is put back exactly as it was found.
  sql(`delete from public.products where id = '${PRODUCT_ID}'`)
  sql(`delete from public.categories where key = '${KEY}'`)
  sql(`delete from public.categories where key = 'audit-anon-category'`)
  const left = sql(`select key from public.categories where key in ('${KEY}', 'audit-anon-category')`)
  const leftProduct = sql(`select id from public.products where id = '${PRODUCT_ID}'`)
  console.log(`\n  the cleanup left ${left.length} category row(s) and ${leftProduct.length} product row(s) behind`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n  ${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
