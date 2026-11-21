// The homepage's code is its own file (src/lib/homePage.js): ad visitors land
// on product pages, so they should not download it. These checks keep the
// split from being undone and keep the homepage itself from waiting for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const APP = read('src/App.jsx')
const HOME_PAGE = read('src/lib/homePage.js')
const CONFIG = read('vite.config.js')
const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|mjs)$/.test(name) ? [path] : []
})

test('App loads the homepage lazily, through the shared loader, inside its own boundary', () => {
  assert.doesNotMatch(APP, /import\s+Home\s+from/, 'a static import would pull the homepage back into every page')
  assert.match(APP, /const Home = lazy\(homePage\.lazy\(HomeUnavailable\)\)/)
  // Its own Suspense, so the header and footer stay on screen while it arrives.
  assert.match(APP, /<Route index element={<Suspense fallback={<HomeWaiting \/>}><Home \/><\/Suspense>} \/>/)
  assert.match(APP, /prefetchHome\(\)/)
})

test('the homepage is fetched by a dynamic import, and nothing imports it statically', () => {
  assert.match(HOME_PAGE, /pageChunk\(\(\) => import\('\.\.\/pages\/Home'\)\)/)
  const root = new URL('../src/', import.meta.url).pathname
  const offenders = sourceFiles(root).filter((file) =>
    /^\s*import\s[^;]*?from\s+['"](?:\.\.?\/)+(?:pages\/)?Home(?:\.jsx)?['"]/m.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders, [], 'any static import would undo the split')
})

test('the fallback that offers a reload is in the main bundle', () => {
  assert.match(APP, /import HomeUnavailable from '\.\/components\/HomeUnavailable'/)
  const page = read('src/components/HomeUnavailable.jsx')
  assert.match(page, /window\.location\.reload\(\)/)
  assert.match(page, /to="\/shop"/)
})

test('on / the page asks for the homepage code straight away, with a plain preload', () => {
  assert.match(CONFIG, /plugins: \[react\(\), spa404\(\), preloadCheckoutOnCheckout\(\), preloadHomeOnHome\(\)(?:, \w+\(\))*\]/)
  const plugin = CONFIG.slice(CONFIG.indexOf('const preloadHomeOnHome'), CONFIG.indexOf('const earlyStartScript'))
  assert.match(plugin, /c\.name === 'Home'/)
  assert.match(plugin, /location\.pathname\.replace\(\/\\\\\/\+\$\/,''\)===''/)
  assert.match(plugin, /l\.rel='preload';l\.as='script';l\.crossOrigin=''/)
  assert.doesNotMatch(plugin, /l\.rel='modulepreload'/)
})
