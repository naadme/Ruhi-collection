// The smaller copies of the client's photographs the browser is offered.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { IMAGE_SIZES, imageSrcSet } from '../src/lib/imageSrcSet.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

test('a bundled photograph is offered in two sizes', () => {
  const set = imageSrcSet('/images/products/denim-shirt-blue.jpg')
  assert.ok(set, 'there is a smaller copy to offer')
  assert.match(set, /\/images\/products\/denim-shirt-blue-640\.jpg 640w/)
  assert.match(set, /\/images\/products\/denim-shirt-blue\.jpg 1600w/)
})

test('the logo is offered at its own smaller size', () => {
  const set = imageSrcSet('/images/ruhi-logo.jpg')
  assert.match(set, /ruhi-logo-320\.jpg 320w/)
  assert.match(set, /ruhi-logo\.jpg 1600w/)
})

test('a photo in the store\'s own storage is offered as it is', () => {
  // There is no smaller copy of an uploaded photo, so no srcset is invented.
  assert.equal(imageSrcSet('https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/product-images/a.jpg'), undefined)
  assert.equal(imageSrcSet(''), undefined)
  assert.equal(imageSrcSet(null), undefined)
  assert.equal(imageSrcSet('/images/products/photo.webp'), undefined, 'only the photographs that were copied')
})

test('the smaller copies really exist', () => {
  const dir = path.join(process.cwd(), 'public/images/products')
  const photos = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f) && !/-\d+\.jpe?g$/i.test(f))
  assert.ok(photos.length > 10, 'there are photographs to check')
  for (const photo of photos) {
    const small = path.join(dir, photo.replace(/\.jpe?g$/i, `-${IMAGE_SIZES.small}.jpg`))
    assert.ok(fs.existsSync(small), `${photo} has its smaller copy`)
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
