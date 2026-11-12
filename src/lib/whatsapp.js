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

/**
 * `https://wa.me/<number>?text=…` from the checkout page: the cart and the
 * total, so whoever answers can see the order without asking. `lines` are
 * `{ title, color, size, qty, amount }`, with `amount` already written as
 * money; at most five are listed.
 */
export function checkoutWhatsAppLink({ number, lines = [], total }) {
  const describe = (l) => {
    const details = [l.color, l.size ? `size ${l.size}` : ''].filter(Boolean).join(', ')
    return `${l.qty} × ${l.title}${details ? ` – ${details}` : ''}${l.amount ? ` (${l.amount})` : ''}`
  }
  const listed = lines.slice(0, 5).map(describe)
  const more = lines.length - listed.length
  if (more > 0) listed.push(`and ${more} more item${more === 1 ? '' : 's'}`)
  const cart = listed.length === 1 ? `My cart: ${listed[0]}.`
    : listed.length ? `My cart:\n${listed.map((t) => `• ${t}`).join('\n')}` : ''
  const text = [
    "Hi Ruhi Collections! I'm at checkout and have a question before paying.",
    cart,
    total ? `Total: ${total}` : '',
  ].filter(Boolean).join('\n')
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

/** The product page's own address, without its query string or fragment. */
export function cleanProductUrl(origin, id) {
  return `${origin}/product/${encodeURIComponent(id)}`
}
