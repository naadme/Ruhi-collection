// The product feed for Google Merchant Center and Meta's catalogue (tracking
// brief, Section 5): one item per colour and size, in Google's product data
// format, which Meta reads as well.
//
// Every ID comes from src/lib/trackingItems.js, the same code that names the
// products in GTM's events, so the feed and the events can never disagree
// (brief Section 7, rule 6). Only products the shop sells are listed — the
// storefront's own rule, src/lib/clientProducts.js — and only the sizes each
// colour stocks.
//
// Pure: api/product-feed.js fetches the rows and serves the XML this returns,
// and tests/productFeed.test.js checks it without a network.

import { isClientProduct } from './clientProducts.js'
import { designDescription, groupRows, partsOf } from './productGrouping.js'
import { BRAND, designGroupId, itemId, price } from './trackingItems.js'

const MAX_TITLE = 150
const MAX_DESCRIPTION = 5000
const MAX_EXTRA_IMAGES = 10

const text = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')
const rupees = (amount) => `${amount.toFixed(2)} INR`

/** An image as a full address: the catalogue keeps some as /images/… paths on this site. */
export function absoluteUrl(src, site) {
  const value = String(src || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return value.startsWith('/') ? `${site}${value}` : `${site}/${value}`
}

/**
 * The feed's items, one per colour row and size.
 *
 * `rows` are `products` rows exactly as the database stores them; `site` is
 * the shop's address, e.g. https://www.ruhi-collections.com.
 *
 * Availability: the shop hides a product the moment it is sold out, and each
 * colour lists only the sizes it stocks, so every size of every product on
 * sale is in stock. A row without a Product ID or a price cannot be sold and
 * is left out.
 */
export function feedItems(rows, { site }) {
  const sold = (rows || []).filter((r) => r && r.is_active !== false && isClientProduct(r))
  const items = []
  for (const { rows: design } of groupRows(sold)) {
    // The description belongs to the design (src/lib/productGrouping.js); the
    // product page shows the first one any of its colours carries.
    const about = text(designDescription(design))
    for (const row of design) {
      const charged = price(row.price)
      const sku = text(row.sku)
      if (!charged || !sku) continue
      const before = price(row.compare)
      const title = text(row.title).slice(0, MAX_TITLE)
      const photos = [...new Set([row.image, ...(Array.isArray(row.gallery) ? row.gallery : []), row.hover]
        .map((src) => absoluteUrl(src, site))
        .filter(Boolean))]
      if (!photos.length) continue
      const colour = text(row.colour) || partsOf(row)?.colour || ''
      const sizes = Array.isArray(row.sizes) && row.sizes.length ? row.sizes : []
      for (const size of sizes) {
        const id = itemId(sku, size)
        if (!id) continue
        items.push({
          id,
          item_group_id: designGroupId(row),
          title,
          // Google requires a description; until the owner writes one, the
          // product's own name is the honest stand-in.
          description: (about || title).slice(0, MAX_DESCRIPTION),
          // The colour is the row's own address; the size rides along so the
          // page opens with it chosen.
          link: `${site}/product/${encodeURIComponent(row.id)}?size=${encodeURIComponent(size)}`,
          image_link: photos[0],
          additional_image_link: photos.slice(1, 1 + MAX_EXTRA_IMAGES),
          // A struck-through price on the page is the regular price; what the
          // shopper pays is the sale price. Both must match the page.
          price: rupees(before > charged ? before : charged),
          sale_price: before > charged ? rupees(charged) : undefined,
          availability: 'in_stock',
          brand: BRAND,
          condition: 'new',
          // The shop's own designs carry no GTIN or MPN — Google's way of
          // saying so.
          identifier_exists: 'no',
          color: colour || undefined,
          size: text(size),
          gender: 'female',
          age_group: 'adult',
        })
      }
    }
  }
  return items
}

const escapeXml = (value) => String(value)
  // Characters XML 1.0 cannot carry at all.
  .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

/** The items as an RSS 2.0 document in Google's `g:` namespace. */
export function feedXml(items, { site, title = BRAND }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    `<title>${escapeXml(title)}</title>`,
    `<link>${escapeXml(site)}</link>`,
    `<description>${escapeXml(`${title} products`)}</description>`,
  ]
  for (const item of items) {
    lines.push('<item>')
    for (const [key, value] of Object.entries(item)) {
      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        if (v === undefined || v === null || v === '') continue
        lines.push(`<g:${key}>${escapeXml(v)}</g:${key}>`)
      }
    }
    lines.push('</item>')
  }
  lines.push('</channel>', '</rss>', '')
  return lines.join('\n')
}
