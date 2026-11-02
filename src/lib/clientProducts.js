// Which rows of the `products` table the shop actually sells: the storefront
// (src/context/ProductsContext.jsx) and the product feed (api/product-feed.js)
// read the same rule, so the feed never lists a product the shop does not show.
//
// This store sells the client's women's catalogue and nothing else. Anything
// else that reaches the `products` table — leftovers of the retired demo
// catalogue, men's rows, stock photography — is dropped here, once, before it
// can reach a card, a filter, search, a related-products list or the
// dashboard. Photo hosts used by that retired catalogue are rejected too, so
// an old row can never render an outside image.
//
// A category is no longer a fixed list of four: the client creates them in
// the admin panel (public.categories, see
// supabase/migrations/20261019130000_client_editable_categories.sql) and
// `products.type` is a foreign key onto that table, so the database already
// guarantees a row points at a real category. What this screen still refuses
// is a *malformed* type — anything that is not a lowercase slug — because
// that is what a leftover demo row looks like, and refusing it costs nothing.
const TYPE_KEY = /^[a-z0-9][a-z0-9-]*$/
const OUTSIDE_PHOTO = /unsplash\.com|placehold|placeholder|picsum|loremflickr|pexels\.com|shutterstock|gettyimages/i

// A row qualifies when it carries a well-formed category, is a women's item,
// and carries no photo from a retired host. NOTE the negation sits inside
// `every`, not outside it: `!every(x => !bad(x))` inverts the test and would
// instead keep *only* the retired demo rows — dropping every real product and
// leaving the storefront on the bundled catalogue forever.
export const isClientProduct = (r) =>
  (typeof r.type === 'string' && TYPE_KEY.test(r.type)) &&
  (r.gender === null || r.gender === undefined || r.gender === 'women') &&
  [r.image, r.hover, ...(Array.isArray(r.gallery) ? r.gallery : [])]
    .filter(Boolean)
    .every((src) => !OUTSIDE_PHOTO.test(String(src)))
