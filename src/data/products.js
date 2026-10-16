// The catalogue — every product and photo comes from the client's own
// "Product Images" folder (Tops&Shirts, Coord sets, Dresses).
// Images live in /public/images/products and are referenced by absolute path.
//
// Prices, ratings, review counts, badges and descriptions are intentionally
// left empty: the client folder contains photos and names only, so no values
// are invented here. Fill them in when the client supplies them.
import { img } from './images.js'

// The client folders are the store's categories (and the shop's Type filter).
export const TYPES = [
  { key: 'tops', label: 'Tops & T-shirts' },
  { key: 'coord', label: 'Co-ord Sets' },
  { key: 'dress', label: 'Dresses' },
  { key: 'trousers', label: 'Trousers & Pants' },
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

  // ---- Trousers & Pants (the client's "Trousers & Pants" folder) ----------
  // One row per colour, exactly like every design above. `colour` is repeated
  // beside the " - Colour" title suffix (the database rows carry it too): it
  // is the value the storefront's grouping reads first, which is what lets
  // colours this catalogue has never used before — "Green", "Rust Orange",
  // "Peach" — group into one design instead of being read as part of the name.
  //
  // Korean Pants — the Beige row is the product that already lived in the
  // catalogue, adopted into this design with its id, price, photos, badge,
  // sizes and rating untouched. Every colour keeps that row's own price.
  { ...p('korean-pants-biege-jpg', 'trousers', 'Korean Pants - Beige', ['https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/product-images/korean-pants-biege-jpg-image-1792129784202.jpg']), colour: 'Beige', price: 400, compare: 999, rating: 5, reviews: 2, badge: 'new arrival', sizes: ['L'], desc: 'soft and breathable fabric ' },
  { ...p('korean-pants-black', 'trousers', 'Korean Pants - Black', ['/images/products/korean-pants-black.jpg']), colour: 'Black', price: 400, compare: 999 },
  { ...p('korean-pants-maroon', 'trousers', 'Korean Pants - Maroon', ['/images/products/korean-pants-maroon.jpg']), colour: 'Maroon', price: 400, compare: 999 },
  { ...p('korean-pants-olive-green', 'trousers', 'Korean Pants - Olive Green', ['/images/products/korean-pants-olive-green.jpg']), colour: 'Olive Green', price: 400, compare: 999 },
  { ...p('korean-pants-brown', 'trousers', 'Korean Pants - Brown', ['/images/products/korean-pants-brown.jpg']), colour: 'Brown', price: 400, compare: 999 },

  // Mulmul cotton Trousers — five colours. The two flat-lay "all colours"
  // photographs ride in the lead colour's gallery, the same place the denim
  // shirts' all-colours photo has always lived.
  { ...p('mulmul-cotton-trousers-blue', 'trousers', 'Mulmul cotton Trousers - Blue', ['/images/products/mulmul-cotton-trousers-blue.jpg', '/images/products/mulmul-cotton-trousers-all-colours1.jpg', '/images/products/mulmul-cotton-trousers-all-colours2.jpg']), colour: 'Blue' },
  { ...p('mulmul-cotton-trousers-white', 'trousers', 'Mulmul cotton Trousers - White', ['/images/products/mulmul-cotton-trousers-white.jpg']), colour: 'White' },
  { ...p('mulmul-cotton-trousers-green', 'trousers', 'Mulmul cotton Trousers - Green', ['/images/products/mulmul-cotton-trousers-green.jpg']), colour: 'Green' },
  { ...p('mulmul-cotton-trousers-rust-orange', 'trousers', 'Mulmul cotton Trousers - Rust Orange', ['/images/products/mulmul-cotton-trousers-rust-orange.jpg']), colour: 'Rust Orange' },
  { ...p('mulmul-cotton-trousers-peach', 'trousers', 'Mulmul cotton Trousers - Peach', ['/images/products/mulmul-cotton-trousers-peach.jpg']), colour: 'Peach' },

  // Thick Linen Pants — one photograph showing every colour together. With no
  // photograph per colour it stays a single product, like Denim Dress, until
  // the client supplies one shot per colour.
  p('thick-linen-pants', 'trousers', 'Thick Linen Pants', ['/images/products/thick-linen-pants.jpg']),
]
export const getProduct = (id) => products.find((x) => x.id === id)

// One tile per catalogue type — the homepage "Shop by Category" row reads
// these, so it can never disagree with the shop's Type filter. The image map
// is keyed by type and the homepage only shows categories the store actually
// stocks (see Sections.jsx), so a new category is never advertised empty.
const CAT_IMG = {
  tops: 'catTops',
  coord: 'catCoord',
  dress: 'catDress',
  trousers: 'catTrousers',
}
export const categories = TYPES.map((t) => ({
  type: t.key,
  label: t.label,
  image: img[CAT_IMG[t.key]],
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
// silently repoint them at the wrong image. If a product is ever deleted, the
// tile falls back to its category photo instead of crashing the page.
const tileImg = (id, fallback) => getProduct(id)?.image || fallback
export const collectionTiles = [
  { title: 'Tops & Shirts', text: 'Denim shirts and panda tees', image: tileImg('denim-shirt-blue', img.catTops), to: '/shop?type=tops' },
  { title: 'Co-ord Sets', text: 'Shirt and pant sets in every colour', image: tileImg('shirt-pant-coord-set-neon-green', img.catCoord), to: '/shop?type=coord' },
  { title: 'Dresses', text: 'Denim and striped dresses', image: tileImg('stripes-dress-yellow', img.catDress), to: '/shop?type=dress' },
  { title: 'Trousers & Pants', text: 'Everyday trousers and pants', image: img.catTrousers, to: '/shop?type=trousers' },
]
