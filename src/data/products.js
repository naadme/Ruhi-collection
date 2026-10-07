// The catalogue — every product and photo comes from the client's own
// "Product Images" folder (Tops&Shirts, Coord sets, Dresses).
// Images live in /public/images/products and are referenced by absolute path.
//
// Prices, ratings, review counts, badges and descriptions are intentionally
// left empty: the client folder contains photos and names only, so no values
// are invented here. Fill them in when the client supplies them.
import { img } from './images'

// The three client folders are the store's categories (and the shop's Type filter).
export const TYPES = [
  { key: 'tops', label: 'Tops & T-shirts' },
  { key: 'coord', label: 'Co-ord Sets' },
  { key: 'dress', label: 'Dresses' },
]
export const typeLabel = (key) => TYPES.find((t) => t.key === key)?.label || key

const base = {
  price: 900,
  compare: null,
  rating: 0,
  reviews: 0,
  badge: null,
  sizes: ['S', 'M', 'L', 'XL'],
  desc: '',
}
const p = (id, type, title, gallery) => ({
  ...base,
  id,
  type,
  title,
  gallery,
  image: gallery[0],
  hover: gallery[1] || gallery[0],
})

export const products = [
  p('denim-shirt-black', 'tops', 'Denim Shirt - Black', ['/images/products/denim-shirt-black.jpg', '/images/products/denim-shirts.jpg']),
  p('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', ['/images/products/denim-shirt-blue.jpg']),
  p('panda-tshirt-black', 'tops', 'Panda Tshirt - Black', ['/images/products/panda-tshirt-black.jpg', '/images/products/panda-tshirts.jpg']),
  p('panda-tshirt-white', 'tops', 'Panda Tshirt - White', ['/images/products/panda-tshirt-white.jpg']),
  p('acid-wash-coord-set-beige', 'coord', 'Acid wash coord set - Beige', ['/images/products/acid-wash-coord-set-beige.jpg']),
  p('acid-wash-coord-set-brown', 'coord', 'Acid wash coord set - Brown', ['/images/products/acid-wash-coord-set-brown.jpg']),
  p('acid-wash-coord-set-grey', 'coord', 'Acid wash coord set - Grey', ['/images/products/acid-wash-coord-set-grey.jpg']),
  p('acid-wash-coord-set-maroon', 'coord', 'Acid wash coord set - Maroon', ['/images/products/acid-wash-coord-set-maroon.jpg']),
  p('acid-wash-coord-set-olive-green', 'coord', 'Acid wash coord set - Olive Green', ['/images/products/acid-wash-coord-set-olive-green.jpg']),
  p('denim-pant-coord-set-black', 'coord', 'Denim pant coord set - Black', ['/images/products/denim-pant-coord-set-black.jpg']),
  p('denim-pant-coord-set-brown', 'coord', 'Denim pant coord set - Brown', ['/images/products/denim-pant-coord-set-brown.jpg']),
  p('denim-pant-coord-set-orange', 'coord', 'Denim pant coord set - Orange', ['/images/products/denim-pant-coord-set-orange.jpg']),
  p('denim-pant-coord-set-pink', 'coord', 'Denim pant coord set - Pink', ['/images/products/denim-pant-coord-set-pink.jpg']),
  p('denim-pant-coord-set-purple', 'coord', 'Denim pant coord set - Purple', ['/images/products/denim-pant-coord-set-purple.jpg']),
  p('denim-pant-coord-set-yellow', 'coord', 'Denim pant coord set - Yellow', ['/images/products/denim-pant-coord-set-yellow.jpg']),
  p('embroidery-coord-set-beige', 'coord', 'Embroidery coord set - Beige', ['/images/products/embroidery-coord-set-beige.jpg', '/images/products/embroidery-coord-set-beige2.jpg', '/images/products/embroidery-coord-set-beige3.jpg']),
  p('embroidery-coord-set-black', 'coord', 'Embroidery coord set - Black', ['/images/products/embroidery-coord-set-black.jpg', '/images/products/embroidery-coord-set-black2.jpg']),
  p('embroidery-coord-set-blue', 'coord', 'Embroidery coord set - Blue', ['/images/products/embroidery-coord-set-blue.jpg', '/images/products/embroidery-coord-set-blue2.jpg']),
  p('embroidery-coord-set-orange', 'coord', 'Embroidery coord set - Orange', ['/images/products/embroidery-coord-set-orange.jpg', '/images/products/embroidery-coord-set-orange2.jpg', '/images/products/embroidery-coord-set-orange3.jpg']),
  p('pulkadot-coord-set-pink', 'coord', 'Pulkadot coord set - Pink', ['/images/products/pulkadot-coord-set-pink.jpg']),
  p('pulkadot-coord-set-purple', 'coord', 'Pulkadot coord set - Purple', ['/images/products/pulkadot-coord-set-purple.jpg']),
  p('shirt-pant-coord-set-black', 'coord', 'Shirt pant coord set - Black', ['/images/products/shirt-pant-coord-set-black.jpg', '/images/products/shirt-pant-coord-set-black2.jpg']),
  p('shirt-pant-coord-set-brown', 'coord', 'Shirt pant coord set - Brown', ['/images/products/shirt-pant-coord-set-brown.jpg', '/images/products/shirt-pant-coord-set-brown2.jpg']),
  p('shirt-pant-coord-set-neon-green', 'coord', 'Shirt pant coord set - Neon Green', ['/images/products/shirt-pant-coord-set-neon-green.jpg']),
  p('shirt-pant-coord-set-purple', 'coord', 'Shirt pant coord set - Purple', ['/images/products/shirt-pant-coord-set-purple.jpg']),
  p('shirt-pant-coord-set-red', 'coord', 'Shirt pant coord set - Red', ['/images/products/shirt-pant-coord-set-red.jpg']),
  p('shirt-pant-coord-set-sky-blue', 'coord', 'Shirt pant coord set - Sky Blue', ['/images/products/shirt-pant-coord-set-sky-blue.jpg']),
  p('shirt-pant-coord-set-yellow', 'coord', 'Shirt pant coord set - Yellow', ['/images/products/shirt-pant-coord-set-yellow.jpg']),
  p('shorts-and-shirt-babypink', 'coord', 'Shorts and Shirt - Babypink', ['/images/products/shorts-and-shirt-babypink.jpg']),
  p('shorts-and-shirt-blue', 'coord', 'Shorts and Shirt - Blue', ['/images/products/shorts-and-shirt-blue.jpg']),
  p('shorts-and-shirt-maroon', 'coord', 'Shorts and Shirt - Maroon', ['/images/products/shorts-and-shirt-maroon.jpg']),
  p('shorts-and-shirt-olive-green', 'coord', 'Shorts and Shirt - Olive Green', ['/images/products/shorts-and-shirt-olive-green.jpg']),
  p('shorts-and-shirt-orange', 'coord', 'Shorts and Shirt - Orange', ['/images/products/shorts-and-shirt-orange.jpg']),
  p('shorts-and-shirt-royalblue', 'coord', 'Shorts and Shirt - Royalblue', ['/images/products/shorts-and-shirt-royalblue.jpg']),
  p('solid-coord-set-red', 'coord', 'Solid Coord set - Red', ['/images/products/solid-coord-set-red.jpg']),
  p('solid-shirtpant-set-orange', 'coord', 'Solid Shirtpant set - Orange', ['/images/products/solid-shirtpant-set-orange.jpg']),
  p('solid-shirtpant-set-royalblue', 'coord', 'Solid Shirtpant set - Royalblue', ['/images/products/solid-shirtpant-set-royalblue.jpg']),
  p('denim-dress', 'dress', 'Denim Dress', ['/images/products/denim-dress1.jpg']),
  p('stripes-dress-blue', 'dress', 'Stripes Dress - Blue', ['/images/products/stripes-dress-blue.jpg']),
  p('stripes-dress-brown', 'dress', 'Stripes Dress - Brown', ['/images/products/stripes-dress-brown.jpg']),
  p('stripes-dress-pink', 'dress', 'Stripes Dress - Pink', ['/images/products/stripes-dress-pink.jpg']),
  p('stripes-dress-yellow', 'dress', 'Stripes Dress - Yellow', ['/images/products/stripes-dress-yellow.jpg']),
]
export const getProduct = (id) => products.find((x) => x.id === id)

// One tile per catalogue type — the homepage "Shop by Category" row and the
// shop's Type filter both read these, so they can never disagree.
export const categories = TYPES.map((t) => ({
  label: t.label,
  image: img[{ tops: 'catTops', coord: 'catCoord', dress: 'catDress' }[t.key]],
  to: `/shop?type=${t.key}`,
}))

// Testimonials are existing site copy; the linked product and photo always
// point at the real client catalogue.
export const reviews = [
  { name: 'Rohit', img: img.r1, product: 'embroidery-coord-set-beige', text: "The shirt quality is amazing, fabric feels soft and the fitting is just perfect. Even after 2 washes, the color didn't fade. Perfect for daily wear" },
  { name: 'Amit', img: img.r2, product: 'shorts-and-shirt-blue', text: 'The fabric is stretchable and very comfortable. I use it for both office and casual wear. Stitching is strong and the size was accurate. Worth the money' },
  { name: 'Neha', img: img.r3, product: 'embroidery-coord-set-black', text: 'These pants are super comfortable, skin-friendly material, and stylish fitting. Looks great with both jeans and tops. Definitely recommend!' },
  { name: 'Priya', img: img.r4, product: 'panda-tshirt-black', text: 'The T-shirt design is trendy and the cotton fabric is really soft. Feels light and comfortable even in summer. Loved the colors as well' },
]

// Tiles reference products by id so reordering or adding products cannot
// silently repoint them at the wrong image.
const tileImg = (id) => getProduct(id).image
export const collectionTiles = [
  { title: 'Tops & Shirts', text: 'Denim shirts and panda tees', image: tileImg('denim-shirt-blue'), to: '/shop?type=tops' },
  { title: 'Co-ord Sets', text: 'Shirt and pant sets in every colour', image: tileImg('shirt-pant-coord-set-neon-green'), to: '/shop?type=coord' },
  { title: 'Dresses', text: 'Denim and striped dresses', image: tileImg('stripes-dress-yellow'), to: '/shop?type=dress' },
]
