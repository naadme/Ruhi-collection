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
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PRODUCTS = path.join(ROOT, 'public/images/products')
const MAX = 640
const LOGO_MAX = 320

const sips = (file, out, max) => {
  execFileSync('/usr/bin/sips', ['-s', 'formatOptions', '82', '-Z', String(max), file, '--out', out], { stdio: 'ignore' })
}

let made = 0
let saved = 0

for (const name of fs.readdirSync(PRODUCTS)) {
  if (!/\.jpe?g$/i.test(name) || /-\d+\.jpe?g$/i.test(name)) continue
  const from = path.join(PRODUCTS, name)
  const to = path.join(PRODUCTS, name.replace(/\.jpe?g$/i, `-${MAX}.jpg`))
  const before = fs.statSync(from).size
  sips(from, to, MAX)
  const after = fs.statSync(to).size
  made += 1
  saved += before - after
}

const logoFrom = path.join(ROOT, 'public/images/ruhi-logo.jpg')
if (fs.existsSync(logoFrom)) {
  sips(logoFrom, path.join(ROOT, 'public/images/ruhi-logo-320.jpg'), LOGO_MAX)
  made += 1
}

console.log(`${made} smaller copies written, ${Math.round(saved / 1024)} KB saved on the wire for one page of product photos.`)
