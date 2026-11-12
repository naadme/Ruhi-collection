// What the "Unpaid checkouts" list shows for each number (see
// supabase/migrations/20261112200000_checkout_leads.sql): the cart as lines
// of text, where the shopper came from, the number written the Indian way,
// and a WhatsApp link with a message about that cart for the owner to send.

import { inr } from '../lib/pricing.js'

/** "1 × Solid Shirt and Pant Combo – Bright Red, size L (₹849)" for each item. */
export function cartLines(items = []) {
  return (Array.isArray(items) ? items : []).map((i) => {
    const details = [i.colour, i.size ? `size ${i.size}` : ''].filter(Boolean).join(', ')
    const amount = Number.isFinite(i.price) && Number.isFinite(i.qty) ? ` (${inr(i.price * i.qty)})` : ''
    return `${i.qty || 1} × ${i.title || 'Item'}${details ? ` – ${details}` : ''}${amount}`
  })
}

const META = /^(facebook|fb|ig|instagram|meta|an|msg)$/i

/** Where the shopper came from: "Meta ad · <ad>", "Google · <campaign>", the campaign tag, or "Direct or unknown". */
export function sourceLabel(row = {}) {
  const source = String(row.utm_source || '').trim()
  const detail = String(row.utm_content || row.utm_campaign || '').trim()
  const named = (label) => (detail ? `${label} · ${detail}` : label)
  if (row.has_meta_click || META.test(source) || /facebook|instagram/i.test(source)) return named('Meta ad')
  if (row.has_google_click || /^google$/i.test(source)) return named('Google')
  if (source) return named(source)
  return 'Direct or unknown'
}

/** "+91 98765 43210". */
export const phoneText = (phone = '') => `+91 ${String(phone).slice(0, 5)} ${String(phone).slice(5)}`

/**
 * WhatsApp to the shopper, with the cart written out. It is about this order
 * only, as checkout promised ("For order updates only. No spam, promise.").
 * The owner can edit it in WhatsApp before sending.
 */
export function shopperWhatsAppLink(row = {}) {
  const lines = cartLines(row.items).slice(0, 5)
  const text = [
    'Hi, this is Ruhi Collections. You were checking out with us:',
    ...lines.map((l) => `• ${l}`),
    'Can we help you complete your order? If you have any questions about the size or delivery, just reply here.',
  ].join('\n')
  return `https://wa.me/91${row.phone}?text=${encodeURIComponent(text)}`
}
