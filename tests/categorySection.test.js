// ONE Categories section in the admin: the manager and the photographs of
// those same categories, side by side.
//
// They used to be two neighbouring tabs, so every category change meant
// finding the same row twice — rename it here, then hunt for it again in
// "Category images" to change its picture. There is now one tab and one place,
// and the two halves are still the very same components (and the same rules)
// as before: nothing was rewritten, only brought together.
//
// What is proved here: the dashboard offers one Categories section and no
// second one; the section renders the manager AND the photographs, manager
// first (so a delete acts on the manager's row); a change made through the
// manager reaches the photographs without a refresh; and neither half can
// touch a product or an image file.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const DASHBOARD = read('src/admin/Dashboard.jsx')
const PANEL = read('src/admin/CategoriesPanel.jsx')
const PHOTOS = read('src/admin/CategoryImagesPanel.jsx')
const MANAGER = read('src/admin/CategoryManager.jsx')

// ---- one section, not two --------------------------------------------------

test('the dashboard offers one Categories section and no second one for the photos', () => {
  const sections = DASHBOARD.slice(DASHBOARD.indexOf('const SECTIONS'), DASHBOARD.indexOf('function SectionSwitch'))
  assert.match(sections, /\['categories', 'Categories'\]/, 'the section is listed')
  assert.doesNotMatch(sections, /category-images/, 'the photographs have no tab of their own any more')
  assert.doesNotMatch(sections, /Category images/, 'and no duplicate wording either')
  // …and it is still rendered by its own panel, through the same switch.
  assert.match(DASHBOARD, /section === 'categories' && <CategoriesPanel/, 'and rendered')
  assert.match(DASHBOARD, /<CategoriesPanel notify=\{notify\} \/>/,
    'the photographs half gets the dashboard\'s own success/error messages')
  assert.doesNotMatch(DASHBOARD, /import CategoryImagesPanel/, 'the dashboard no longer draws it itself')
})

test('an old link to the photographs tab lands on the combined section', () => {
  assert.match(DASHBOARD, /wanted === 'category-images' \? 'categories' : wanted/,
    'a bookmark made while the photos had their own tab still works')
})

// ---- the section brings the two halves together ----------------------------

test('the section is the manager AND the photographs of those same categories', () => {
  assert.match(PANEL, /<CategoryManagerPanel/, 'the manager the product editor opens as a modal')
  assert.match(PANEL, /<CategoryImagesPanel notify=\{notify\} revision=\{revision\} \/>/,
    'and the photo list, told when the manager has saved')
  assert.ok(
    PANEL.indexOf('<CategoryManagerPanel') < PANEL.indexOf('<CategoryImagesPanel'),
    'the manager is above the photographs: a row found by its name is the one a Rename or Delete acts on',
  )
  // One heading for the whole section.
  assert.equal((PANEL.match(/<h1/g) || []).length, 1, 'exactly one heading for the one section')
  assert.match(PANEL, /await reload\(\)/, 'and the list the storefront reads is re-read after a change')
})

test('the photographs follow a change the manager makes in the same section', () => {
  // The manager saves → the section bumps `revision` → the photo list reads
  // the rows again, so a category added or renamed here appears there at once.
  assert.match(PANEL, /setRevision\(\(n\) => n \+ 1\)/)
  assert.match(PHOTOS, /export default function CategoryImagesPanel\(\{ notify = \(\) => \{\}, revision = 0 \}\)/,
    'the photo list takes the signal')
  assert.match(PHOTOS, /useEffect\(\(\) => \{ load\(\) \}, \[load, revision\]\)/,
    'and re-reads when it changes — as well as when the catalogue behind the default photo does')
})

test('every guarantee the photograph half had is still exactly where it was', () => {
  // The thumbnail shows the photo the SITE shows: the owner's, only when it
  // is switched on; otherwise the default the storefront itself would pick.
  assert.match(PHOTOS, /\(active && row\.image\) \|\| row\.defaultImage/)
  assert.match(PHOTOS, /categoryImage\(c, products\)/)
  assert.match(PHOTOS, /The site’s default photo/)
  // A photo is not published until Save is pressed, and the row says so.
  assert.match(PHOTOS, /Not saved yet/)
  assert.match(PHOTOS, /await saveCategoryImage\(row\.key, row\.image, row\.is_active !== false\)/)
  assert.match(PHOTOS, /setActive\(row\.key, row\.is_active === false\)/)
  // Uploads, the site's own photographs, the on/off switch and the clear.
  assert.match(PHOTOS, /uploadCategoryImage/)
  assert.match(PHOTOS, /CATEGORY_IMAGE_OPTIONS/)
  assert.match(PHOTOS, /onClear/)
  // The filter the other panels offer.
  assert.match(PHOTOS, /<StatusFilter/)
  assert.match(PHOTOS, /await reload\(\)/)
})

// ---- nothing here can take away a product or an image ----------------------

test('changing a photograph touches only that category row', () => {
  assert.doesNotMatch(PHOTOS, /from\('products'\)/, 'the photo half never reads or writes the catalogue')
  assert.doesNotMatch(PHOTOS, /deleteProduct|\.delete\(/, 'and never deletes anything')
  // Every upload is a NEW, timestamped file, so a photo can never overwrite
  // another category's picture.
  const store = read('src/lib/categoryImageStore.js')
  assert.match(store, /`category-\$\{Date\.now\(\)\}\.\$\{ext\}`/, 'the file name is unique per upload')
  assert.match(store, /upsert: false/, 'and the upload can never replace an existing file')
  assert.doesNotMatch(store, /\.remove\(/, 'nothing is ever deleted from storage')
})

test('deleting a category refuses while any product is in it, and touches no product', () => {
  assert.match(MANAGER, /still holds \$\{n\}/, 'the panel says how many products are in the way')
  assert.match(MANAGER, /no product and no order was touched/, 'and says that nothing was lost')
  const rules = read('src/lib/categories.js')
  assert.match(rules, /if \(usage == null\) \{/, 'an unknown count is never treated as empty')
  assert.match(rules, /\.from\('categories'\)\.delete\(\)\.eq\('key', key\)/,
    'the only delete is the category row itself, by its own key')
  assert.doesNotMatch(rules, /from\('products'\)\.delete|\.delete\(\)\s*\.eq\('id'/,
    'no product row is ever deleted through this file')
})
