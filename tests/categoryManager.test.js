// Add Category (requirement 6): a visible button, a real modal, a working
// save, and no way for the category form to submit the product form beside it.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { categoryKey, categoryLabelKey, findDuplicate, mergeCategories } from '../src/lib/categoryRules.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
// The source, with its comments removed — a file's prose may describe the
// bug it fixed, and that prose must not be mistaken for the code itself.
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const MANAGER = read('src/admin/CategoryManager.jsx')
const MANAGER_CODE = code('src/admin/CategoryManager.jsx')
const EDITOR = read('src/admin/ProductEditor.jsx')
const API = read('src/lib/categories.js')

test('the trigger is a properly sized button, not an underline', () => {
  assert.match(MANAGER, /<Plus size=\{14\} aria-hidden="true" \/> Add category/, 'labelled and iconed')
  assert.match(MANAGER, /h-\[38px\] px-3 rounded-lg border/, 'a real, hit-able control')
  assert.doesNotMatch(MANAGER, /underline underline-offset-2/, 'the 13px underlined text link is gone')
  assert.match(MANAGER, /type="button"\n\s*onClick=\{\(\) => \{ setOpen\(true\)/,
    'a button, so it can never submit the product form it sits inside')
})

test('the panel is a MODAL, portalled outside the product form', () => {
  assert.match(MANAGER, /createPortal/, 'rendered through a portal')
  assert.match(MANAGER, /document\.body/, 'and attached to document.body, so it is not a child of the product <form>')
  assert.match(MANAGER, /role="dialog"/)
  assert.match(MANAGER, /aria-modal="true"/, 'announced as modal')
  assert.match(MANAGER, /aria-label="Manage categories"/)
  assert.equal(
    (MANAGER_CODE.match(/<form/g) || []).length,
    1,
    'exactly one <form> in the whole component, and it lives in the portal — the shared submit path with the product editor is gone',
  )
})

test('the modal can always be dismissed, and focus lands in the name box', () => {
  assert.match(MANAGER, /e\.key === 'Escape'\) setOpen\(false\)/, 'Escape closes it')
  assert.match(MANAGER, /onMouseDown=\{close\}/, 'the backdrop closes it')
  assert.match(MANAGER, /aria-label="Close category management"/, 'and so does the X')
  assert.match(MANAGER, /nameInput\.current\?\.focus\(\)/, 'the name box takes focus')
})

test('create has Save and Cancel, and cannot reach the product form', () => {
  assert.match(MANAGER, /onSubmit=\{add\}/, 'a real form with a submit path')
  assert.match(MANAGER, /e\?\.preventDefault\?\.\(\)/, 'no page reload')
  assert.match(MANAGER, /e\?\.stopPropagation\?\.\(\)/, 'and nothing escapes to any other form')
  assert.match(MANAGER, /Save\s*\n\s*<\/button>/, 'a Save button')
  assert.match(MANAGER, /Cancel\s*\n\s*<\/button>/, 'and a Cancel button')
  assert.match(MANAGER, /disabled=\{busy === 'add' \|\| !label\.trim\(\)\}/, 'nothing to save with no name')
})

test('a newly added category is selectable at once', () => {
  assert.match(MANAGER, /await onSaved\?\.\(row\)/, 'the parent is told about the new row')
  assert.match(EDITOR, /reloadCategories/, 'the editor reloads the list')
  assert.match(EDITOR, /setShared\(\{ type: row\.key \}\)/, 'and selects the new category for the product being edited')
})

test('the editor still offers the manager beside the category picker', () => {
  assert.match(EDITOR, /<CategoryManager/, 'where a category is actually chosen')
  assert.match(EDITOR, /canManageCategories/, 'and only for accounts the database would allow')
  assert.match(EDITOR, /<select value=\{form\.shared\.type\}[\s\S]*typeOptions\.map/, 'the picker itself is intact')
})

// ---- the rules that make it work -------------------------------------------

test('a category name cannot be added twice, however it is spelled', () => {
  const existing = mergeCategories([{ key: 'tops', label: 'Tops & T-shirts', position: 0 }])
  assert.ok(findDuplicate(existing, 'tops & t-shirts'), 'case is ignored')
  assert.ok(findDuplicate(existing, 'Tops and Tshirts') === null, 'a different name is a different category')

  const list = mergeCategories([{ key: 'kurtis', label: 'Kurtis', position: 1 }])
  assert.ok(findDuplicate(list, 'kurtis'), 'the key matches too')
  assert.ok(findDuplicate(list, '  Kurtis  '), 'surrounding spaces are ignored')
  assert.ok(findDuplicate(list, 'KUR-ISIS') === null, 'hyphenation only folds the comparison')
  assert.equal(findDuplicate(list, ''), null, 'an empty name is never a duplicate of itself')
})

test('names are stored safely: no slug for the owner to think about', () => {
  assert.equal(categoryKey('Trousers & Pants'), 'trousers-pants', 'the same answer the database has always had')
  assert.equal(categoryKey('Kurtis'), 'kurtis')
  assert.equal(categoryKey('   '), '', 'nothing usable, refused')
  assert.equal(categoryKey('!!!'), '', 'punctuation alone is refused')
  assert.equal(categoryLabelKey('Winter Wear'), 'winter wear')
})

test('the write path refuses a duplicate before anything is saved', () => {
  assert.match(API, /findDuplicate\(existing, clean\)/, 'checked in the browser first')
  assert.match(API, /is already a category/, 'with a sentence the owner can read')
  assert.match(API, /\/duplicate\/i\.test\(error\.message/, 'and again from the database’s own unique index')
})

test('existing categories and their products are untouched by any of this', () => {
  assert.match(API, /update\(\{ label: clean \}\)/, 'a rename writes the label only — never the key')
  assert.doesNotMatch(API, /\.update\(\{ key/)
  assert.match(API, /inUse > 0/, 'a category in use is never deleted')
})
