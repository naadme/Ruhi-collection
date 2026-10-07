// Sends the contact form to the `send-contact-email` Edge Function.
//
// Only the four fields leave the browser. The recipient, subject and body are
// decided server-side, so this can never be pointed at an arbitrary mailbox,
// and no key or secret is involved anywhere in the browser.

import { supabase } from './supabase'

const FALLBACK =
  "We couldn't send your message. Please try again in a moment."

/** The server's own `{ error }` sentence, or `''` when it has none. */
async function messageFrom(response) {
  try {
    const parsed = await response?.json?.()
    const message = parsed?.error
    return typeof message === 'string' && message.trim() ? message.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Submit the contact form.
 *
 * Resolves `{ ok: true }`, or `{ ok: false, message }` — it never throws, so
 * the page can always put the shopper back in front of their own text and let
 * them try again.
 */
export async function sendContactMessage({ name, email, phone, comment }) {
  try {
    const { error, response } = await supabase.functions.invoke('send-contact-email', {
      body: {
        name: (name || '').trim(),
        email: (email || '').trim(),
        phone: (phone || '').trim(),
        comment: (comment || '').trim(),
      },
    })
    if (!error) return { ok: true }
    return { ok: false, message: (await messageFrom(response)) || FALLBACK }
  } catch {
    return { ok: false, message: FALLBACK }
  }
}
