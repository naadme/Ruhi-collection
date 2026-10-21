// The All / Active / Inactive filter the banner, best seller and category
// photo panels share.
//
// The rules are in src/lib/statusFilter.js; these tests pin down what each
// filter shows, what counts as active, and that the panels actually use it —
// a filter that exists but is not wired up would leave an owner looking at an
// empty panel with no way to tell why.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_STATUS,
  STATUS_FILTERS,
  countByStatus,
  filterByStatus,
  isActiveItem,
  isInactiveItem,
  isStatusValue,
} from '../src/lib/statusFilter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('there are exactly three filters: All, Active and Inactive', () => {
  assert.deepEqual(STATUS_FILTERS.map((f) => f.value), ['all', 'active', 'inactive'])
  assert.deepEqual(STATUS_FILTERS.map((f) => f.label), ['All', 'Active', 'Inactive'])
  assert.equal(DEFAULT_STATUS, 'all', 'a panel starts on All')
})

test('an item is active unless it says otherwise', () => {
  assert.equal(isActiveItem({ is_active: true }), true)
  assert.equal(isActiveItem({ is_active: false }), false)
  // A row that predates the switch has no flag at all: it was on before, so
  // it stays on.
  assert.equal(isActiveItem({}), true)
  assert.equal(isActiveItem({ is_active: undefined }), true)
  assert.equal(isActiveItem(null), true)
  assert.equal(isInactiveItem({ is_active: false }), true)
  assert.equal(isInactiveItem({}), false)
})

test('each filter shows what it says it shows', () => {
  const items = [
    { id: 'a', is_active: true },
    { id: 'b', is_active: false },
    { id: 'c', is_active: true },
    { id: 'd' },
  ]
  assert.deepEqual(filterByStatus(items, 'all').map((i) => i.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(filterByStatus(items, 'active').map((i) => i.id), ['a', 'c', 'd'])
  assert.deepEqual(filterByStatus(items, 'inactive').map((i) => i.id), ['b'])
})

test('the filters never change the order of what they show', () => {
  const items = [
    { id: 'a', is_active: false },
    { id: 'b', is_active: true },
    { id: 'c', is_active: false },
  ]
  assert.deepEqual(filterByStatus(items, 'inactive').map((i) => i.id), ['a', 'c'])
  assert.deepEqual(filterByStatus(items, 'all').map((i) => i.id), ['a', 'b', 'c'])
})

test('an empty list filters to an empty list, not to everything', () => {
  assert.deepEqual(filterByStatus([], 'all'), [])
  assert.deepEqual(filterByStatus([], 'active'), [])
  assert.deepEqual(filterByStatus([], 'inactive'), [])
  assert.deepEqual(filterByStatus(null, 'active'), [])
})

test('an unknown filter shows everything rather than nothing', () => {
  const items = [{ id: 'a' }, { id: 'b', is_active: false }]
  // A stale value must never leave a panel looking empty.
  assert.equal(filterByStatus(items, 'nonsense').length, 2)
  assert.equal(filterByStatus(items, undefined).length, 2)
  assert.equal(isStatusValue('active'), true)
  assert.equal(isStatusValue('nonsense'), false)
})

test('the counts say how many each filter would show', () => {
  const items = [
    { id: 'a', is_active: true },
    { id: 'b', is_active: false },
    { id: 'c' },
  ]
  assert.deepEqual(countByStatus(items), { all: 3, active: 2, inactive: 1 })
  assert.deepEqual(countByStatus([]), { all: 0, active: 0, inactive: 0 })
  assert.deepEqual(countByStatus(null), { all: 0, active: 0, inactive: 0 })
})

// --- the panels use it ------------------------------------------------------

test('all three panels offer the filter and a status indicator', () => {
  const panels = {
    'src/admin/BannerPanel.jsx': 'banner',
    'src/admin/BestsellerPanel.jsx': 'bestseller',
    'src/admin/CategoryImagesPanel.jsx': 'category photo',
  }
  for (const [file, what] of Object.entries(panels)) {
    const code = read(file)
    assert.match(code, /import StatusFilter from '\.\/StatusFilter\.jsx'/, `${what}: the filter is imported`)
    assert.match(code, /<StatusFilter\b/, `${what}: the filter is rendered`)
    assert.match(code, /countByStatus\(/, `${what}: the counts come from the shared rule`)
    assert.match(code, /filterByStatus\(/, `${what}: the rows are filtered by the shared rule`)
    // Every item carries a status the owner can read.
    assert.match(code, /is_active/, `${what}: the item's own status is on the row`)
  }
})

test('the filter switch is the same control everywhere', () => {
  const control = read('src/admin/StatusFilter.jsx')
  assert.match(control, /STATUS_FILTERS\.map/, 'it draws the shared three filters')
  assert.match(control, /aria-pressed=\{on\}/, 'and says which one is on')
  assert.match(control, /counts\[f\.value\]/, 'and how many each would show')
})

test('a panel with nothing to show says so instead of looking broken', () => {
  for (const file of [
    'src/admin/BannerPanel.jsx',
    'src/admin/BestsellerPanel.jsx',
    'src/admin/CategoryImagesPanel.jsx',
  ]) {
    assert.match(read(file), /switch the filter to All/i, `${file}: an empty filter says what to do`)
  }
})

test('the banners keep their place in the order whether they are on or off', () => {
  const panel = read('src/admin/BannerPanel.jsx')
  // The filter shows a subset; the list it filters is the real one.
  assert.match(panel, /const shown = useMemo\(\(\) => filterByStatus\(state\.rows, status\)/,
    'the rows are filtered for display only')
  assert.match(panel, /const i = state\.rows\.indexOf\(row\)/,
    'and each row keeps its true position, so its number and its arrows are its own')
  // Reordering is switched off while a filter is on, because a filtered list
  // has gaps in it.
  assert.match(panel, /canReorder=\{status === 'all'\}/,
    'the arrows are only live on the whole list')
})
