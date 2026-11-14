// The shop's web fonts (speed decision D2, 13 Nov 2026).
//
// The fonts' CSS now lives in src/fonts.css, holding only Google's "latin" files.
// Google's own CSS also listed a latin-ext file per family, and the rupee sign
// (U+20B9) is in that range, so every page with a price downloaded an ~83 KB
// Inter file just to draw it. Now the phone's own font draws the sign.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const css = read('src/fonts.css')
const html = read('index.html')

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const get = (key) => body.match(new RegExp(`${key}:\\s*([^;]+);`))?.[1].trim()
  return {
    family: get('font-family')?.replace(/['"]/g, ''),
    weight: get('font-weight'),
    style: get('font-style'),
    display: get('font-display'),
    src: get('src'),
    range: get('unicode-range'),
  }
})
const covers = (range, code) => range.split(',').some((part) => {
  const [lo, hi = lo] = part.trim().replace(/^U\+/, '').split('-').map((x) => parseInt(x, 16))
  return code >= lo && code <= hi
})

test('the page no longer asks fonts.googleapis.com for CSS (one blocking request less)', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com/)
  assert.doesNotMatch(html, /rel="stylesheet"/, 'no stylesheet in index.html; Vite adds the bundle')
})

test('the font files still come from fonts.gstatic.com, whose connection opens early', () => {
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>/)
  for (const face of faces) {
    assert.match(face.src, /^url\(https:\/\/fonts\.gstatic\.com\/s\/[a-z]+\/v\d+\/[\w-]+\.woff2\) format\('woff2'\)$/, `${face.family} ${face.weight}`)
  }
})

test('every family and weight the old Google link asked for is still declared', () => {
  const declared = faces.map((f) => `${f.family} ${f.weight}`).sort()
  const wanted = [
    ...['400', '500', '600', '700'].map((w) => `Inter ${w}`),
    ...['400', '500', '600', '700'].map((w) => `Jost ${w}`),
    ...['500', '600', '700'].map((w) => `Cormorant Garamond ${w}`),
  ].sort()
  assert.deepEqual(declared, wanted)
})

test('each face is Google\'s latin file: normal style, swap, the latin range', () => {
  assert.equal(faces.length, 11)
  for (const face of faces) {
    assert.equal(face.style, 'normal')
    assert.equal(face.display, 'swap', 'text shows at once in a fallback font, as before')
    assert.equal(face.range, LATIN)
  }
})

test('no face covers the rupee sign, so no font file is downloaded just for it', () => {
  for (const face of faces) assert.equal(covers(face.range, 0x20b9), false, `${face.family} ${face.weight}`)
  assert.equal(covers(LATIN, 'A'.charCodeAt(0)), true, 'the range check itself works')
})

test('every font stack ends in a generic family, which draws the rupee sign', () => {
  const config = read('tailwind.config.js')
  const stacks = config.match(/fontFamily:\s*\{([^}]*)\}/)[1]
  const lists = [...stacks.matchAll(/(\w+):\s*\[([^\]]*)\]/g)]
  assert.ok(lists.length >= 3)
  for (const [, name, list] of lists) assert.match(list.trim(), /'(sans-serif|serif)'$/, `${name} ends in a generic family`)
})

test('the font rules load with the shop\'s own styles, before them', () => {
  const main = read('src/main.jsx')
  const fonts = main.indexOf("import './fonts.css'")
  assert.ok(fonts >= 0, 'main.jsx imports the fonts')
  assert.ok(fonts < main.indexOf("import './index.css'"))
})
