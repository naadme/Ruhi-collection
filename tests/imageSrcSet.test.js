// The smaller copies of the client's photographs the browser is offered.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { IMAGE_SIZES, imageSrcSet } from '../src/lib/imageSrcSet.js'
import derivatives from '../src/lib/imageDerivatives.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

test('a bundled photograph is offered in two sizes', () => {
  const set = imageSrcSet('/images/products/denim-shirt-blue.jpg')
  assert.ok(set, 'there is a smaller copy to offer')
  assert.match(set, /\/images\/products\/denim-shirt-blue-640\.jpg 640w/)
  // The width given for the original is the photograph's real width, so the
  // browser does not believe it is larger than it is.
  const original = derivatives['/images/products/denim-shirt-blue.jpg']
  assert.match(set, new RegExp(`/images/products/denim-shirt-blue\\.jpg ${original.original}w`))
  assert.ok(original.original >= 688 && original.original <= 1086, 'the real width of the client\'s photo')
})

test('the logo is offered at its own smaller size', () => {
  const set = imageSrcSet('/images/ruhi-logo.jpg')
  assert.match(set, /ruhi-logo-320\.jpg 320w/)
  assert.match(set, new RegExp(`ruhi-logo\\.jpg ${derivatives['/images/ruhi-logo.jpg'].original}w`))
})

test('a photo in the store\'s own storage is offered as it is', () => {
  // There is no smaller copy of an uploaded photo, so no srcset is invented.
  assert.equal(imageSrcSet('https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/product-images/a.jpg'), undefined)
  assert.equal(imageSrcSet(''), undefined)
  assert.equal(imageSrcSet(null), undefined)
  assert.equal(imageSrcSet('/images/products/photo.webp'), undefined, 'only the photographs that were copied')
})

test('a photograph without a smaller copy is served as it is', () => {
  // A photo added to the folder without running the copy script must not send
  // the browser after a file that does not exist.
  assert.equal(imageSrcSet('/images/products/a-brand-new-photo.jpg'), undefined)
  assert.equal(imageSrcSet('/images/products/denim-shirt-blue.png'), undefined)
})

test('the smaller copies really exist', () => {
  const dir = path.join(process.cwd(), 'public/images/products')
  const photos = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f) && !/-\d+\.jpe?g$/i.test(f))
  assert.ok(photos.length > 10, 'there are photographs to check')
  for (const photo of photos) {
    const small = path.join(dir, photo.replace(/\.jpe?g$/i, `-${IMAGE_SIZES.small}.jpg`))
    assert.ok(fs.existsSync(small), `${photo} has its smaller copy`)
    assert.ok(derivatives[`/images/products/${photo}`], `${photo} is listed for the browser`)
  }
  assert.ok(fs.existsSync(path.join(process.cwd(), 'public/images/ruhi-logo-320.jpg')))
})

test('the cards and the tiles ask for the size they are shown at', () => {
  const card = read('src/components/ProductCard.jsx')
  assert.match(card, /sizes="\(max-width: 640px\) 50vw[^"]*300px"/, 'the product card')
  const sections = read('src/components/Sections.jsx')
  assert.match(sections, /sizes="\(max-width: 768px\) 45vw, 272px"/, 'the homepage category tile')
  const img = read('src/components/Img.jsx')
  assert.match(img, /srcSet=\{srcSet\}/, 'and the image component passes it on')
  assert.match(img, /sizes=\{srcSet \? sizes : undefined\}/)
})

test('the photographs folder holds no stray duplicates', () => {
  // `sips` will not overwrite an existing file: it writes "name 2.jpg"
  // beside it instead. A re-run of the copy script must therefore leave the
  // folder exactly as it found it — no duplicates, no missing photographs.
  const dir = path.join(process.cwd(), 'public/images/products')
  const files = fs.readdirSync(dir)
  const strays = files.filter((f) => /\s\d+\.jpe?g$/i.test(f))
  assert.deepEqual(strays, [], `stray copies in the photographs folder: ${strays.join(', ')}`)
  const originals = files.filter((f) => /\.jpe?g$/i.test(f) && !/-\d+\.jpe?g$/i.test(f))
  for (const photo of originals) {
    assert.ok(
      files.includes(photo.replace(/\.jpe?g$/i, `-${IMAGE_SIZES.small}.jpg`)),
      `${photo} has its smaller copy`,
    )
  }
})

test('the built site holds no stray duplicates either', () => {
  // The same stray copies used to reach the published folder, where a static
  // host would have served them.
  const dir = path.join(process.cwd(), 'dist/images/products')
  if (!fs.existsSync(dir)) return // the site has not been built here
  const strays = fs.readdirSync(dir).filter((f) => /\s\d+\.jpe?g$/i.test(f))
  assert.deepEqual(strays, [], `stray copies in the published folder: ${strays.join(', ')}`)
})

test('a failed smaller copy falls back to the original photograph', () => {
  // The browser picks one candidate and stops: if that file is not there, the
  // picture has to be retried from the original rather than left broken.
  const img = read('src/components/Img.jsx')
  assert.match(img, /if \(srcSet && !original\) setOriginal\(true\)/)
  assert.match(img, /const srcSet = copy && !original \? copy\.srcset : undefined/)
})

test('the picture\'s own src is the smaller copy, not the original', () => {
  // A browser fetches `src` before it reads the `srcset`. Naming the
  // full-size photograph there means every phone downloads it in full and
  // then downloads the smaller copy as well.
  const img = read('src/components/Img.jsx')
  assert.match(img, /const shown = copy && !original \? copy\.small : src/)
  assert.match(img, /src=\{shown\}/)
  // …and the original is still offered to a screen that needs it.
  const lib = read('src/lib/imageSrcSet.js')
  assert.match(lib, /srcset: `\$\{src\.replace[\s\S]*?\} \$\{copy\.small\}w, \$\{src\} \$\{copy\.original\}w`/)
})
