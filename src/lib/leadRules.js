// The pure half of checkoutLeads.js (no Supabase client), so tests can import it.

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined)

/** The ad source worth keeping from attributionForOrder(): campaign tags, and whether a Meta or Google click brought the shopper. */
export function leadSource(attribution = {}) {
  const a = attribution && typeof attribution === 'object' ? attribution : {}
  const out = {
    utm_source: text(a.utm_source),
    utm_medium: text(a.utm_medium),
    utm_campaign: text(a.utm_campaign),
    utm_content: text(a.utm_content),
    has_meta_click: Boolean(a.fbc),
    has_google_click: Boolean(a.gclid || a.gbraid || a.wbraid),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

/** The cart as the database stores it: product IDs, sizes and quantities only. */
export const leadItems = (lines = []) => lines.map((l) => ({ product_id: l.id, size: l.size, qty: l.qty }))
