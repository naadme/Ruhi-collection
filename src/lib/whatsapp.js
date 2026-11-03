// The WhatsApp chat link offered on a product page: the shop's number, with a
// message that already names the product, so the shopper only has to ask.
//
// The product link is the plain product URL — no ad tags or click IDs from the
// address bar — so what the shop receives is a clean link it can open.

/** `https://wa.me/<number>?text=…` for a question about one product. */
export function productWhatsAppLink({ number, title, color, size, price, url }) {
  const details = [color, size ? `size ${size}` : ''].filter(Boolean).join(', ')
  const product = [title, details ? `(${details})` : '', price ? `– ${price}` : ''].filter(Boolean).join(' ')
  const text = `Hi Ruhi, I have a question about the ${product}.\n${url}`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

/** The product page's own address, without its query string or fragment. */
export function cleanProductUrl(origin, id) {
  return `${origin}/product/${encodeURIComponent(id)}`
}
