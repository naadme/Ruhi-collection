#!/usr/bin/env node
/**
 * Build the smaller copies the site can offer the browser.
 *
 *   node scripts/build-image-derivatives.mjs
 *
 * The client's photographs are 688–1086 px wide and are shown in lists at
 * 272–300 CSS pixels — that is 544–600 pixels on a phone, and a full-size
 * download for every card. A 640-pixel copy is exactly enough for the
 * largest of those, is produced from the client's own file (so nothing is
 * re-shot, re-coloured or invented), and roughly halves what the homepage
 * downloads.
 *
 * The browser is offered both through `srcset`: the small copy for the size
 * the photo is actually shown at, and the original for a large screen.
 *
 * The script also writes `src/lib/imageDerivatives.json`, the list of the
 * photographs that have a smaller copy and how wide each file really is. The
 * site reads that list before offering a `srcset`, so a photograph that was
 * added without a copy is simply served as it is instead of pointing the
 * browser at a file that is not there.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PRODUCTS = path.join(ROOT, 'public/images/products')
const MANIFEST = path.join(ROOT, 'src/lib/imageDerivatives.js')
const MAX = 640
const LOGO_MAX = 320

const sips = (file, out, max) => {
  // `sips` will not overwrite an existing output: it writes "name 2.jpg"
  // beside it instead, which would leave a stray copy of every photograph in
  // the folder (and publish it). The target is removed first, so a re-run
  // always produces exactly the same set of files.
  try { fs.rmSync(out, { force: true }) } catch { /* nothing to remove */ }
  execFileSync('/usr/bin/sips', ['-s', 'formatOptions', '82', '-Z', String(max), file, '--out', out], { stdio: 'ignore' })
}

/** The real width of a picture, in pixels. */
const pixelWidth = (file) => {
  const out = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' })
  const match = out.match(/pixelWidth:\s*(\d+)/)
  return match ? Number(match[1]) : 0
}

let made = 0
let saved = 0
const manifest = {}

for (const name of fs.readdirSync(PRODUCTS)) {
  if (!/\.jpe?g$/i.test(name)) continue
  // Already a smaller copy: "-640.jpg".
  if (/-\d+\.jpe?g$/i.test(name)) continue
  // A stray duplicate — "name 2.jpg" — left by an earlier copy. It is not a
  // photograph of the client's and must never be given a copy of its own.
  if (/\s\d+\.jpe?g$/i.test(name)) continue
  const from = path.join(PRODUCTS, name)
  const to = path.join(PRODUCTS, name.replace(/\.jpe?g$/i, `-${MAX}.jpg`))
  const before = fs.statSync(from).size
  sips(from, to, MAX)
  const after = fs.statSync(to).size
  made += 1
  saved += before - after
  manifest[`/images/products/${name}`] = { small: MAX, original: pixelWidth(from) }
}

const logoFrom = path.join(ROOT, 'public/images/ruhi-logo.jpg')
if (fs.existsSync(logoFrom)) {
  sips(logoFrom, path.join(ROOT, 'public/images/ruhi-logo-320.jpg'), LOGO_MAX)
  made += 1
  manifest['/images/ruhi-logo.jpg'] = { small: LOGO_MAX, original: pixelWidth(logoFrom) }
}

fs.writeFileSync(MANIFEST, `// Written by scripts/build-image-derivatives.mjs — do not edit by hand.\n// The photographs that have a smaller copy, and how wide each file really is.\nexport default ${JSON.stringify(manifest, null, 2)}\n`)
console.log(`${made} smaller copies written, ${Math.round(saved / 1024)} KB saved on the wire for one page of product photos.`)
console.log(`${Object.keys(manifest).length} photographs listed in ${path.relative(ROOT, MANIFEST)}.`)
