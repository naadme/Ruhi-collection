// The admin panel's one way of talking to the Google Sheets function.
//
// Everything private — the client secret, the refresh token, the access
// token — stays in the Edge Function. The browser only ever sends an action
// name and the ids of the orders that are on screen, and only ever receives
// plain text: a status, a spreadsheet title, a link, or a sentence explaining
// what is missing.

import { supabase } from './supabase.js'

export const SHEETS_FUNCTION = 'google-sheets'

/**
 * The body of a failed call, when the function sent one.
 *
 * A non-2xx answer arrives as an error whose `context` is the Response; the
 * setup steps the server wrote for the owner live in that body, and an admin
 * cannot fix a missing secret from a one-line toast.
 */
async function readErrorBody(error) {
  try {
    const body = await error?.context?.json?.()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/**
 * Call the Google Sheets function.
 *
 * Throws an Error that carries `setup` (a list of steps to follow) and
 * `needsReconnect` (Google wants the owner to approve access again).
 */
export async function sheetsAction(action, body = {}) {
  const { data, error } = await supabase.functions.invoke(SHEETS_FUNCTION, {
    body: { action, ...body },
  })

  const detail = await readErrorBody(error)
  if (error || !data?.ok) {
    const failure = new Error(
      detail?.error
      || error?.message
      || 'Google Sheets did not respond. Please try again.',
    )
    failure.setup = Array.isArray(detail?.setup) ? detail.setup : null
    failure.setupLinks = Array.isArray(detail?.setupLinks) ? detail.setupLinks : null
    failure.needsReconnect = detail?.needsReconnect === true
    throw failure
  }
  return data
}
