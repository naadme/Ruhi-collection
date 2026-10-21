// order-notifications
//
// Sends the two order emails — the customer's confirmation and the owner's
// new-order notification — for orders that are ready to be announced.
//
// WHO CALLS IT
//
//   * The database. A deferred trigger on `public.orders` fires at COMMIT, so
//     by the time this function runs the order and all of its lines are on
//     file. That is the only path that catches a cash-on-delivery order: the
//     storefront pays online, so the payment functions never see one.
//
//   * The owner, by hand, to sweep anything a failed send left behind.
//
// WHY IT NEEDS A SECRET
//
// The function sends mail. Anything that could reach it without proving who
// it is would be a mail relay: a stranger could make the store write to any
// address they liked. So the caller must present `ORDER_NOTIFICATIONS_SECRET`
// — the same shared-secret pattern the daily sheet sync already uses — and
// the secret lives only in Edge Function secrets and in the database's vault.
//
// The recipient of the owner's mail is a constant inside the code, and the
// customer's mail goes to the address on the order, so no caller can redirect
// either of them.

import { serve } from '../_shared/deno.ts'
import { env, MissingConfigError, requireEnv } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { safeEqualHex } from '../_shared/crypto.ts'
import { serviceFetch } from '../_shared/supabase.ts'
import { sendOrderConfirmation } from '../_shared/confirmation.ts'
import { sendOwnerNotification } from '../_shared/ownerNotification.ts'

const NOT_CONFIGURED = 'Order notifications are not configured.'
const NOT_ALLOWED = 'Order notifications are not allowed from here.'
const FAILED = 'The order notifications could not be sent.'

/** The header the database trigger and the owner both use. */
const SECRET_HEADER = 'x-order-notifications-secret'

/**
 * How far back the sweep looks for an order whose send failed.
 *
 * Only recent orders are swept. The shop's own history — orders placed
 * before this feature existed — must never be announced all at once, and an
 * order that is more than a day old has long since been dealt with by hand.
 */
const SWEEP_WINDOW_HOURS = 24

/** How many orders one call will deal with. */
const SWEEP_LIMIT = 20

/**
 * Orders that still owe somebody a mail.
 *
 * The same two rules the senders use — a settled online order, or a
 * cash-on-delivery order — and one that keeps a cancelled order quiet: a
 * parcel that is not going out must never be announced as though it were.
 * The second half of the rule ("one of the two mails has not gone yet") is
 * applied here rather than in the query, because PostgREST takes one `or=`
 * per parameter and the two halves have to hold together.
 */
const PENDING = 'or=(payment_status.eq.paid,payment_method.eq.cod)&status=neq.cancelled'

/** Compare the caller's secret with ours, without leaking its length. */
function secretMatches(presented: string): boolean {
  const expected = env('ORDER_NOTIFICATIONS_SECRET') ?? ''
  if (!expected || !presented) return false
  return safeEqualHex(presented, expected)
}

/**
 * The orders that still owe a mail, newest first.
 *
 * Only ones placed inside the sweep window: an order from last month is not
 * something to announce now.
 */
async function pendingOrders(): Promise<string[]> {
  const since = new Date(Date.now() - SWEEP_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const res = await serviceFetch(
    `/rest/v1/orders?${PENDING}` +
      `&created_at=gte.${encodeURIComponent(since)}` +
      '&select=id,confirmation_sent_at,owner_notified_at&order=created_at.desc&limit=' + SWEEP_LIMIT,
  )
  if (!res.ok) {
    console.warn('[order-notifications] could not read the pending orders:', res.status)
    return []
  }
  const rows = (await res.json().catch(() => [])) as Json[]
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row) => !row.confirmation_sent_at || !row.owner_notified_at)
    .map((row) => asString(row.id))
    .filter(Boolean)
}

/** Tell everybody who is owed a mail about one order. */
async function announce(orderId: string): Promise<{ customer: string; owner: string }> {
  const customer = await sendOrderConfirmation(orderId)
  const owner = await sendOwnerNotification(orderId)
  const say = (outcome: { sent: boolean; reason?: string; detail?: string }) =>
    outcome.sent
      ? 'sent'
      : [outcome.reason, outcome.detail].filter(Boolean).join(' ')
  return { customer: say(customer), owner: say(owner) }
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    requireEnv('ORDER_NOTIFICATIONS_SECRET')
  } catch {
    return fail(503, NOT_CONFIGURED)
  }

  if (!secretMatches(req.headers.get(SECRET_HEADER) ?? '')) {
    return fail(401, NOT_ALLOWED)
  }

  try {
    const body = await readJson(req)
    const named = asString(body.order_id)

    // The order the caller named, plus anything else that is still owed a mail
    // from the last day. The named one is handled even if it is older, so a
    // failed send can be retried deliberately.
    const ids = new Set<string>()
    if (named) ids.add(named)
    for (const id of await pendingOrders()) ids.add(id)

    const done: Record<string, { customer: string; owner: string }> = {}
    for (const id of ids) done[id] = await announce(id)

    const sent = Object.values(done).filter((r) => r.customer === 'sent' || r.owner === 'sent').length
    return json(200, { ok: true, orders: Object.keys(done).length, sent, results: done })
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(503, NOT_CONFIGURED)
    console.warn('[order-notifications] failed:', String(error))
    return fail(500, FAILED)
  }
}

serve(handle)
