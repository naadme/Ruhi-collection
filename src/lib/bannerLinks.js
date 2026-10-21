// Where a homepage banner takes the shopper.
//
// The admin chooses the destination for EACH banner — a product page, a
// category page, a page of the shop, or an approved external address. The
// rules live here so the panel that writes a destination and the storefront
// that follows it can never disagree, and so a banner can never take a
// shopper somewhere that does not exist.
//
// The rules
//   * a destination is either a path on this site ("/shop?type=dress") or an
//     absolute https:// address;
//   * anything else — a typo, a "javascript:" URL, a path to a page that was
//     never built — is refused, and the banner falls back to the shop;
//   * an empty destination is not an error: it means "the shop", which is
//     where the hero's own fallback slides point.

import { groupedCards } from './productGrouping.js'
import { productHref } from './productLinks.js'

export const BANNER_FALLBACK = '/shop'

/** The pages of this site a banner may point at. */
export const SITE_DESTINATIONS = [
  { value: '/shop', label: 'All products' },
  { value: '/collections', label: 'Collections' },
  { value: '/about', label: 'About' },
  { value: '/contact', label: 'Contact' },
]

/**
 * Every destination a banner may be pointed at: the shop's own pages, every
 * category, and every product.
 *
 * The products are the DESIGN cards — the same ones the shop shows — so a
 * banner points at a page a shopper can actually open, and never at a colour
 * row the shop does not list on its own.
 */
export function bannerDestinations(categories, products) {
  const cats = (Array.isArray(categories) ? categories : [])
    .map((c) => ({ value: `/shop?type=${c.key}`, label: `${c.label} (category)` }))
  // The product's own route — the same one the shop card and the search
  // result use (src/lib/productLinks.js), so a banner can never point at a
  // different product than the shop shows.
  const items = groupedCards(products || []).map((p) => ({ value: productHref(p), label: `${p.title} (product)` }))
  return [...SITE_DESTINATIONS, ...cats, ...items]
}

/**
 * Is this a destination the site is willing to follow?
 *
 * A path is accepted when it starts with a single "/" — so "/shop" and
 * "/product/denim-shirt-blue" are fine, but "//evil.example" (which the
 * browser would read as another site) is not. An absolute address is accepted
 * only over https.
 */
export function isValidBannerLink(value) {
  const link = String(value ?? '').trim()
  if (!link) return true // empty means "the shop" — handled by the fallback
  if (link.startsWith('/')) return !link.startsWith('//')
  return /^https:\/\/[^\s]+$/i.test(link)
}

/**
 * The destination a banner actually goes to.
 *
 * A blank or unusable destination falls back to the shop, so a banner can
 * never lead a shopper to a broken page — and never to nowhere.
 */
export function bannerDestination(value) {
  const link = String(value ?? '').trim()
  if (!link) return BANNER_FALLBACK
  if (!isValidBannerLink(link)) return BANNER_FALLBACK
  return link
}

/** A sentence describing where a banner points, for the admin panel. */
export function describeBannerDestination(value) {
  const link = String(value ?? '').trim()
  if (!link) return 'The shop (the default)'
  if (!isValidBannerLink(link)) return 'Not a usable link — this banner will open the shop'
  if (link.startsWith('http')) return `Another site: ${link}`
  if (link.startsWith('/product/')) return `The product page ${link.slice('/product/'.length)}`
  if (link.startsWith('/shop?type=')) return `The category page ${link.slice('/shop?type='.length)}`
  const known = SITE_DESTINATIONS.find((d) => d.value === link)
  if (known) return known.label
  return link
}

/**
 * The message shown when a destination is refused.
 *
 * Empty when the destination is fine, so the panel can call it on every
 * change and show the complaint only when there is one.
 */
export function bannerLinkProblem(value) {
  const link = String(value ?? '').trim()
  if (!link || isValidBannerLink(link)) return ''
  if (link.startsWith('//')) return 'That link points at another site. Use a full https:// address, or a path that starts with a single /.'
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return 'Only https:// addresses and paths on this site can be used.'
  return 'That is not a link this site can open. Use a path that starts with /, or a full https:// address.'
}
