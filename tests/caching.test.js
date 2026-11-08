// How long browsers may keep the site's files and the owner's uploads.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const vercel = JSON.parse(read('vercel.json'))
const cacheFor = (source) => vercel.headers
  ?.find((rule) => rule.source === source)
  ?.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value

test('built code and styles are kept for a year', () => {
  // Vite puts a hash of the content in every file name under /assets, so a
  // changed file is a new address and the old one never changes.
  assert.equal(cacheFor('/assets/(.*)'), 'public, max-age=31556952, immutable')
})

test('bundled photographs are kept for a day', () => {
  // Their names carry no hash: a photograph replaced under the same name
  // must reach returning shoppers within a day.
  assert.equal(cacheFor('/images/(.*)'), 'public, max-age=86400')
})

test('the page itself is never given a long cache', () => {
  // index.html names the current /assets files; caching it would keep
  // shoppers on an old release.
  for (const rule of vercel.headers ?? []) {
    assert.ok(!['/(.*)', '/', '/index.html', '/:path*'].includes(rule.source), `no cache rule for ${rule.source}`)
  }
})

test('the routing and the daily job are unchanged', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
  assert.deepEqual(vercel.crons, [{ path: '/api/google-sheets-sync', schedule: '0 6 * * *' }])
})

test('every photo upload is stored as cacheable for a year, under a new name', () => {
  const uploaders = [
    'src/admin/ProductEditor.jsx',
    'src/admin/BannerPanel.jsx',
    'src/admin/PageImagesPanel.jsx',
    'src/lib/categoryImageStore.js',
  ]
  for (const file of uploaders) {
    const source = read(file)
    const call = source.slice(source.indexOf('.upload(path, file, {'))
    const options = call.slice(0, call.indexOf('})'))
    assert.match(options, /cacheControl: '31536000'/, `${file} keeps uploads for a year`)
    // A year is only safe because an upload never replaces an existing file.
    assert.match(options, /upsert: false/, `${file} never overwrites a file`)
    assert.match(source, /Date\.now\(\)\}\.\$\{ext\}/, `${file} names each upload uniquely`)
  }
})
