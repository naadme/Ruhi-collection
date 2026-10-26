// All photography is the client's own product folder, copied verbatim into
// /public/images/products (nothing is loaded from the internet).
// Category/review/hero slots reuse those same real photos.
const p = (file) => `/images/products/${file}`

export const img = {
  // Homepage hero
  heroMain: p('shorts-and-shirt-royalblue.jpg'),
  heroTop: p('embroidery-coord-set-beige3.jpg'),
  heroStore: p('denim-dress1.jpg'),
  // Editorial sections
  story: p('embroidery-coord-set-blue.jpg'),
  aboutHero: p('denim-dress1.jpg'),
  aboutA: p('stripes-dress-pink.jpg'),
  aboutB: p('acid-wash-coord-set-olive-green.jpg'),
  // The Contact page draws this as a thin full-width strip (about 6.5:1), so a
  // portrait photograph of a person loses head and hem. A flat-lay of the
  // trousers in all their colours reads as an intentional band of colour at
  // that shape, and has no face to cut.
  contact: p('mulmul-cotton-trousers-all-colours1.jpg'),
  // "Shop by category" tiles — one real photo per catalogue type
  catTops: p('denim-shirt-blue.jpg'),
  catCoord: p('acid-wash-coord-set-beige.jpg'),
  catDress: p('stripes-dress-blue.jpg'),
  // Trousers & Pants has no dedicated client photo yet; this real shot shows
  // the trousers prominently. Swap it when the client supplies one.
  catTrousers: p('denim-pant-coord-set-black.jpg'),
  // Customer review photos (each matches the product it is linked to)
  r1: p('embroidery-coord-set-beige2.jpg'),
  r2: p('shorts-and-shirt-blue.jpg'),
  r3: p('embroidery-coord-set-black2.jpg'),
  r4: p('panda-tshirt-black.jpg'),
}
