// The product feed URL for Google Merchant Center and Meta's catalogue
// (tracking brief, Section 5): https://www.ruhi-collections.com/api/product-feed
//
// It reads the catalogue straight from Supabase on request — the same public
// read the storefront makes with the same public key — so the feed is always
// as current as the shop. Vercel's edge keeps a copy for up to an hour, far
// inside the brief's "at least once a day".
//
// It holds no secret and writes nothing. If Supabase cannot be reached it
// answers with an error rather than an empty feed: Merchant Center would read
// an empty feed as "every product is gone".

import { feedItems, feedXml } from '../src/lib/productFeed.js'

const COLUMNS = 'id,sku,title,type,colour,gender,price,compare,sizes,image,hover,gallery,description,is_active,created_at'
// The design ID (20261102130000_design_ids.sql) is asked for first and dropped
// again on a database that does not have it yet, which then groups by name.
const WITH_DESIGN = `${COLUMNS},design_id`

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    res.status(500).json({ ok: false, error: 'The product feed is not configured on this deployment.' })
    return
  }

  // Links and photos point at the address the feed was fetched from, so the
  // feed on www.ruhi-collections.com links to www.ruhi-collections.com.
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'www.ruhi-collections.com').split(',')[0].trim()
  const site = `https://${host}`

  try {
    const read = (columns) => fetch(
      `${url.replace(/\/$/, '')}/rest/v1/products?select=${columns}&is_active=eq.true&order=created_at.desc,id.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    let response = await read(WITH_DESIGN)
    if (response.status === 400) response = await read(COLUMNS)
    if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
    const rows = await response.json()
    const xml = feedXml(feedItems(Array.isArray(rows) ? rows : [], { site }), { site })
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.status(200).send(xml)
  } catch (error) {
    console.error('[product-feed]', String(error && error.message ? error.message : error))
    res.setHeader('Cache-Control', 'no-store')
    res.status(502).json({ ok: false, error: 'The catalogue could not be read. Try again shortly.' })
  }
}
