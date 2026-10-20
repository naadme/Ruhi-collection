// google-sheets-sync
//
// The automatic daily sync of the orders into the owner's Google Sheet.
//
// WHY IT EXISTS
// -------------
// The client asked for a spreadsheet that holds every order and is updated
// every day, without anyone having to remember to press "Export". The manual
// export in the admin panel is still there — the owner may want to re-send
// something on purpose — but the sheet must not depend on someone remembering.
//
// HOW IT IS CALLED
// ----------------
//   * by the scheduled job (a daily Vercel cron that forwards here), and
//   * by the payment functions, the moment a payment is verified.
//
// The second one is what makes the sheet genuinely up to date: an order
// reaches the sheet seconds after it is paid, and the daily job is the safety
// net for anything the event-driven path missed.
//
// WHO MAY CALL IT
// ---------------
// Either a signed-in store owner (the admin panel) or the scheduler, which
// proves itself with a shared secret. There is no third way in: the function
// holds the owner's Google tokens, so it must not be an open door.
//
// WHAT IT DOES
// ------------
//   1. sends the orders the sheet does not have yet — never twice, because
//      the ledger of sent orders is the only thing that decides what is new;
//   2. updates the rows whose status has changed, in place;
//   3. records what it did, so the admin panel can show a real status.
//
// Nothing here decides whether an order is paid — that is the payment
// server's job alone — and a failed sync never touches an order.

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { fail, json, preflight, type Json } from '../_shared/http.ts'
import { serviceFetch } from '../_shared/supabase.ts'
import { runSync } from '../_shared/sheetSyncRun.ts'

const baseUrl = () => env('SUPABASE_URL') ?? ''

/** The shared secret the scheduler proves itself with. */
const syncSecret = () => env('GOOGLE_SHEETS_SYNC_SECRET') ?? ''

/** Is this caller allowed to run the sync? */
function isScheduler(req: Request): boolean {
  const secret = syncSecret()
  if (!secret) return false
  const given = req.headers.get('x-sync-secret') ?? ''
  return given.length > 0 && given === secret
}

/** Is this caller the signed-in store owner? */
async function isOwner(req: Request): Promise<boolean> {
  const authorization = req.headers.get('authorization') ?? ''
  if (!authorization) return false
  const res = await serviceFetch('/auth/v1/user', {
    headers: { Authorization: authorization, apikey: env('SUPABASE_ANON_KEY') ?? '' },
  })
  if (!res.ok) return false
  const user = (await res.json().catch(() => null)) as Json | null
  const id = String(user?.id ?? '')
  if (!id) return false
  const admin = await serviceFetch(`/rest/v1/admins?user_id=eq.${encodeURIComponent(id)}&select=user_id&limit=1`)
  if (!admin.ok) return false
  const rows = (await admin.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length > 0
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  const allowed = isScheduler(req) || (await isOwner(req))
  if (!allowed) {
    return fail(401, 'Only the store owner or the scheduler may run the sync.')
  }

  try {
    const result = await runSync()
    return json(result.ok ? 200 : 503, result)
  } catch (error) {
    console.warn('[google-sheets-sync] failed:', String(error))
    return fail(500, 'The sync did not finish.')
  }
}

serve(handle)
