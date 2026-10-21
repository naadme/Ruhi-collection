// The category rules the admin panel and the storefront both depend on:
// adding a category, refusing to delete one that is in use, and switching a
// category's photograph off without losing it.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { categoryImage, categoryTiles } from '../src/lib/categoryTiles.js'
import { mergeCategories, SEED_CATEGORIES } from '../src/lib/categoryRules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// --- the photograph can be switched off -------------------------------------

test('a photograph that is switched off is not the one the site shows', () => {
  const category = { key: 'dress', label: 'Dresses', image: '/images/products/the-owner-own-photo.jpg' }
  // Switched on: the owner's own photograph.
  assert.equal(categoryImage(category, []), '/images/products/the-owner-own-photo.jpg')
  // Switched off: the site falls back to the photograph that ships with the
  // shop, exactly as it does for a category that has none of its own.
  assert.equal(categoryImage({ ...category, image_active: false }, []), '/images/products/stripes-dress-blue.jpg')
})

test('a switched-off photograph falls back to a product photo when the shop has no default', () => {
  // "night-wear" is a category the shop added later: it has no photograph of
  // its own, so the site uses the first product photo in it.
  const category = { key: 'night-wear', label: 'Night Wear', image: '/images/products/the-owner-own-photo.jpg', image_active: false }
  const products = [{ type: 'night-wear', image: '/images/products/night-wear-pink.jpg' }]
  assert.equal(categoryImage(category, products), '/images/products/night-wear-pink.jpg')
  assert.equal(categoryImage(category, []), null, 'and nothing at all when there is no product either')
})

test('the category keeps its photograph when the photograph is switched off', () => {
  const merged = mergeCategories([
    { key: 'dress', label: 'Dresses', position: 0, image: '/images/products/x.jpg', image_active: false },
  ])
  const row = merged.find((c) => c.key === 'dress')
  assert.equal(row.image, '/images/products/x.jpg', 'the photograph itself is kept')
  assert.equal(row.image_active, false, 'and the switch says it is not in use')
})

test('a category that says nothing about the switch is active', () => {
  const merged = mergeCategories([{ key: 'dress', label: 'Dresses', position: 0 }])
  assert.equal(merged.find((c) => c.key === 'dress').image_active, true)
  // The seeded categories have never been switched off.
  assert.ok(SEED_CATEGORIES.every((c) => c.image_active === true))
})

test('the storefront tiles honour the switch', () => {
  const categories = [
    { key: 'night-wear', label: 'Night Wear', position: 0, image: '/images/products/x.jpg', image_active: false },
  ]
  // The tile for a switched-off photograph falls back like any other tile.
  const tiles = categoryTiles(categories, [{ type: 'night-wear', image: '/images/products/y.jpg' }])
  assert.equal(tiles.length, 1)
  assert.equal(tiles[0].image, '/images/products/y.jpg', 'the product photo, not the switched-off one')
})

test('the database gives every category a photograph that is on', () => {
  const migration = read('supabase/migrations/20261021120000_category_image_active.sql')
  assert.match(migration, /add column if not exists image_active boolean not null default true/,
    'the column is added with the value that keeps every category exactly as it was')
  assert.match(migration, /begin;/, 'and it runs as one transaction')
  assert.match(migration, /commit;/)
})

test('the panel saves the photograph and the switch together', () => {
  const store = read('src/lib/categoryImageStore.js')
  assert.match(store, /export const saveCategoryImage = async \(key, image, isActive\)/,
    'one write carries both')
  assert.match(store, /if \(isActive !== undefined\) payload\.image_active = isActive !== false/,
    'and a caller that only wants to change the photograph cannot switch it by accident')

  const panel = read('src/admin/CategoryImagesPanel.jsx')
  assert.match(panel, /await saveCategoryImage\(row\.key, row\.image, row\.is_active !== false\)/,
    'the panel writes both')
  assert.match(panel, /setActive\(row\.key, row\.is_active === false\)/,
    'and the switch changes the draft')
})

// --- adding and deleting ----------------------------------------------------

test('a new category is given its own code without anyone setting it by hand', () => {
  // The database assigns the code when the row is saved, so a category is
  // numbered the moment it is added — no code change, no redeployment.
  const skus = read('supabase/migrations/20261020120000_product_skus.sql')
  assert.match(skus, /create trigger categories_assign_code/, 'the trigger is there')
  const rules = read('src/lib/categories.js')
  assert.match(rules, /\.select\('key, label, position, code'\)/, 'and the code comes back with the row')
})

test('a category that still holds products cannot be deleted, and says why', () => {
  const rules = read('src/lib/categories.js')
  assert.match(rules, /if \(usage == null\) \{/, 'an unknown count is never treated as an empty category')
  assert.match(rules, /still in this category/, 'and the refusal is spelled out')
  assert.match(rules, /Move them to another category first/, 'with the way out')

  const panel = read('src/admin/CategoryManager.jsx')
  assert.match(panel, /still holds \$\{n\}/, 'the panel says how many products are in the way')
  assert.match(panel, /no product and no order was touched/, 'and says that nothing was lost')
})

test('the categories are a section of the dashboard in their own right', () => {
  const dashboard = read('src/admin/Dashboard.jsx')
  assert.match(dashboard, /\['categories', 'Categories'\]/, 'the section is listed')
  assert.match(dashboard, /section === 'categories' && <CategoriesPanel/, 'and rendered')
  const panel = read('src/admin/CategoriesPanel.jsx')
  assert.match(panel, /<CategoryManagerPanel/, 'it uses the same manager the product editor opens')
  assert.match(panel, /await reload\(\)/, 'and re-reads the list the storefront reads')
})

test('the product editor still offers the manager, and still selects a new category', () => {
  const editor = read('src/admin/ProductEditor.jsx')
  assert.match(editor, /<CategoryManager/, 'the manager is beside the category picker')
  assert.match(editor, /reloadCategories/, 'the editor re-reads the list')
  assert.match(editor, /setShared\(\{ type: row\.key \}\)/, 'and selects the category just added')
})

test('the database refuses to delete a category that still has products', () => {
  // The rule the panel honours is also the rule the database enforces, so a
  // stale count can never orphan a product.
  const migration = read('supabase/migrations/20261019130000_client_editable_categories.sql')
  assert.match(migration, /products_type_fkey/, 'the foreign key is there')
  assert.match(migration, /on delete restrict/i, 'and it refuses the delete')
})
