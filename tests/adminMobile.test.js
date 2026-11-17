// The admin on a phone (17 Nov 2026): nothing may be wider than the screen,
// the sections are one dropdown, filter rows scroll sideways, and the phone
// layout ships in the admin's own stylesheet so shop pages never download it.
//
// The layout itself was checked in a real browser at 320 and 360 px wide
// (every section, the product editor, an opened order); these tests pin the
// rules that keep it that way.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const ADMIN = 'src/admin'
const jsx = readdirSync(path.join(process.cwd(), ADMIN))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => ({ file: `${ADMIN}/${f}`, src: read(`${ADMIN}/${f}`) }))
const css = read(`${ADMIN}/admin.css`)
const root = read(`${ADMIN}/AdminRoot.jsx`)

/** Every class list written in the admin's markup, template strings included. */
const classLists = (src) => [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2])

test('the phone layout ships with the admin, not with the shop', () => {
  assert.match(root, /import '\.\/admin\.css'/, 'AdminRoot imports the admin stylesheet')
  assert.doesNotMatch(read('src/main.jsx'), /admin\.css/, 'the shop entry never imports it')
  assert.doesNotMatch(css, /@tailwind|@import/, 'it adds no Tailwind layer and pulls in no other file')
  assert.match(root, /className="adm-root /, 'the admin page carries the class its rules are scoped to')
  assert.match(root, /<main className="adm-main /, 'and <main> the class that stops sideways scrolling')
})

test('nothing in an admin page can make the page wider than the phone', () => {
  assert.match(css, /\.adm-main\s*\{[^}]*overflow-x:\s*clip/, '<main> clips anything wider than the screen')
  assert.match(css, /@media \(max-width: 639\.98px\)/, 'the phone rules stop where the sm: layout starts')
})

test('a grid with columns only on wider screens has one screen-wide column on a phone', () => {
  // `grid sm:grid-cols-2` leaves a phone with one automatic column, which grows
  // to the widest unbroken line inside it: that pushed the order details, the
  // best seller list and the banner list off the right of the screen.
  const offenders = []
  for (const { file, src } of jsx) {
    for (const list of classLists(src)) {
      const classes = list.split(/\s+/)
      if (!classes.includes('grid')) continue
      const wide = classes.some((c) => /^(sm|md|lg|xl):grid-cols-/.test(c))
      const base = classes.some((c) => /^grid-cols-/.test(c))
      if (wide && !base) offenders.push(`${file}: ${list}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('on a phone the sections are one dropdown, on a wide screen the tabs', () => {
  const dash = read(`${ADMIN}/Dashboard.jsx`)
  const fn = dash.slice(dash.indexOf('function SectionSwitch'), dash.indexOf('export default function Dashboard'))
  assert.match(fn, /<label className="adm-phone-only[^"]*">[\s\S]*<select/, 'a dropdown for the phone')
  assert.match(fn, /onChange=\{\(e\) => onChange\(e\.target\.value\)\}/, 'choosing a section opens it')
  assert.match(fn, /'adm-wide-only '/, 'the tabs step aside on a phone')
  assert.match(fn, /if \(sections\.length < 2\) return tabs/, 'a product manager, with one section, keeps the single tab')
  assert.match(css, /\.adm-root \.adm-phone-only\s*\{\s*display: none;/, 'the dropdown is hidden on a wide screen')
})

test('every filter row scrolls sideways on a phone instead of running off it', () => {
  const strips = {
    'StatusFilter.jsx': 1, // banners, best sellers, category photos
    'ReviewsPanel.jsx': 1,
    'OrdersPanel.jsx': 1,
    'UnpaidCheckoutsPanel.jsx': 1,
  }
  for (const [file, n] of Object.entries(strips)) {
    const src = read(`${ADMIN}/${file}`)
    assert.equal((src.match(/adm-strip /g) || []).length, n, `${file} has its filter row as a strip`)
  }
  assert.match(css, /\.adm-root \.adm-strip\s*\{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/)
})

test('every admin class the markup uses is defined in the admin stylesheet', () => {
  const used = new Set()
  for (const { src } of jsx) for (const list of classLists(src)) for (const c of list.match(/\badm-[a-z-]+/g) || []) used.add(c)
  const defined = new Set([...css.matchAll(/\.(adm-[a-z-]+)/g)].map((m) => m[1]))
  const missing = [...used].filter((c) => !defined.has(c))
  assert.deepEqual(missing, [], 'a class used in the markup but defined nowhere does nothing')
  const unused = [...defined].filter((c) => !used.has(c) && c !== 'adm-root' && c !== 'adm-main')
  assert.deepEqual(unused, [], 'a rule no markup uses is dead weight')
})

test('the Page images section opens without crashing', () => {
  // Its "anything changed?" check compares each draft with the saved slot on
  // every render; with no saved slots yet, the very first render threw.
  const src = read(`${ADMIN}/PageImagesPanel.jsx`)
  assert.doesNotMatch(src, /const \[saved, setSaved\] = useState\(\[\]\)/)
  assert.match(src, /const \[saved, setSaved\] = useState\(\(\) => PAGE_IMAGES\.map\(\(d\) => draftFor\(d, null\)\)\)/)
})

test('an opened order shows each item in full on a phone', () => {
  const src = read(`${ADMIN}/OrdersPanel.jsx`)
  assert.match(src, /<span className="min-w-0 break-words">\s*\{it\.title\}/, 'the item line wraps: size, quantity and Product ID stay readable')
})
