// PostgREST access for the Edge Functions.
//
// Two identities are used, and only two:
//   * the caller's own JWT (or the anon key for a guest), so `create_order()`
//     runs as the shopper who placed the order and `auth.uid()` is theirs;
//   * the service role, for the writes and reads no browser may perform —
//     recording `razorpay_order_id`, marking an order paid, feeding the
//     webhook ledger.
//
// There is no other path to `payment_status`.

import { requireEnv } from './env.ts'
import type { Json } from './http.ts'

function baseUrl(): string {
  return requireEnv('SUPABASE_URL').replace(/\/$/, '')
}

/** Headers for a call made *as the shopper* (guest → anon). */
export function callerHeaders(authorization?: string | null): Record<string, string> {
  const anon = requireEnv('SUPABASE_ANON_KEY')
  // The header arrives as `Bearer <token>`; a guest arrives with no header, and
  // some clients send a non-JWT key. Only a real JWT is worth forwarding — it
  // is what makes `auth.uid()` (and therefore `user_id`) the shopper's own.
  const token = (authorization ?? '').replace(/^bearer\s+/i, '').trim()
  const bearer = token.startsWith('eyJ') ? token : anon
  return { apikey: anon, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }
}

/** Headers for a call made *as the payment server*. Never leaves this runtime. */
export function serviceHeaders(): Record<string, string> {
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
}

export async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers as Record<string, string> | undefined) },
  })
}

export interface RpcResult {
  ok: boolean
  data?: Json
  /** A sentence safe to show a shopper. */
  message?: string
}

const GENERIC = 'We could not start your order. Please try again.'

/**
 * Call `public.create_order()`.
 *
 * The function raises friendly `P0001` messages for everything the shopper can
 * fix. Anything else (a constraint, a syntax problem, PostgREST's own errors)
 * is replaced with a generic sentence so no schema detail is ever disclosed.
 */
export async function rpcCreateOrder(
  payload: Json,
  authorization?: string | null,
): Promise<RpcResult> {
  const res = await fetch(`${baseUrl()}/rest/v1/rpc/create_order`, {
    method: 'POST',
    headers: callerHeaders(authorization),
    body: JSON.stringify({ payload }),
  })

  const body = (await res.json().catch(() => null)) as
    | { code?: string; message?: string; reference?: string; id?: string }
    | null

  if (!res.ok) {
    const friendly = res.status !== 401 && body?.code === 'P0001' && typeof body.message === 'string'
    return { ok: false, message: friendly ? body.message : GENERIC }
  }

  if (!body || typeof body.reference !== 'string' || typeof body.id !== 'string') {
    return { ok: false, message: GENERIC }
  }
  return { ok: true, data: body as Json }
}

/** SELECT the columns verification and the webhook need, by primary key. */
export async function fetchOrder(id: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(id)}` +
      '&select=id,reference,status,full_name,email,phone,address,city,state,pincode,note,' +
      'payment_method,payment_status,razorpay_order_id,razorpay_payment_id,paid_at,' +
      'subtotal,shipping,total,created_at',
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? (rows[0] ?? null) : null
}

/** SELECT an order by one of its Razorpay identifiers. */
export async function fetchOrderByColumn(
  column: 'razorpay_order_id' | 'razorpay_payment_id' | 'reference',
  value: string,
): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/orders?${column}=eq.${encodeURIComponent(value)}` +
      '&select=id,reference,status,payment_method,payment_status,razorpay_order_id,' +
      'razorpay_payment_id,paid_at,subtotal,shipping,total,created_at',
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? (rows[0] ?? null) : null
}

/** The order line snapshot shown on the confirmation page. */
export async function fetchOrderItems(orderId: string): Promise<Json[]> {
  const res = await serviceFetch(
    `/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}` +
      '&select=product_id,title,image,size,qty,unit_price',
  )
  if (!res.ok) return []
  return ((await res.json().catch(() => [])) as Json[]) ?? []
}
