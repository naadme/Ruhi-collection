// Unpaid checkouts (12 Nov 2026, checkout change 4): checkout's half.
//
// Once a shopper with something in the cart has typed a valid Indian mobile
// number, the number, the cart (product IDs, sizes, quantities) and the ad
// source are recorded through public.save_checkout_lead(), so the owner can
// offer help on WhatsApp if they leave without paying. The form says the
// number is "For order updates only. No spam, promise.". It runs in the
// background, and any error is ignored.

import { supabase } from './supabase.js'
import { leadItems, leadSource } from './leadRules.js'

export { leadItems, leadSource }

/** Record or refresh this number at checkout. Never throws. */
export async function saveCheckoutLead({ phone, items, source }) {
  try {
    await supabase.rpc('save_checkout_lead', { p_phone: phone, p_items: items, p_source: source || {} })
  } catch {
    /* recording a lead must never get in the shopper's way */
  }
}
