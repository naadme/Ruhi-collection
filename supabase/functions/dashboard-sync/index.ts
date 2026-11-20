// dashboard-sync
//
// Copies the numbers behind the admin's "Daily numbers" section from Meta ads,
// GA4 and Razorpay into the dash_* tables
// (supabase/migrations/20261120120000_daily_dashboard.sql).
//
// WHO MAY CALL IT
//   * the hourly job (pg_cron → public.dash_request_sync()), which proves
//     itself with DASHBOARD_SYNC_SECRET in `x-dashboard-sync-secret`;
//   * the store owner, from "Refresh now" in the admin (their own session).
// Nobody else: it holds read keys to the shop's ads, analytics and payments.
//
// WHAT IT DOES
//   Re-reads the last 7 days (everything since 1 Oct 2026 on the first run),
//   because Meta and GA4 keep revising recent days. Each source is read and
//   written on its own: one that fails is recorded and the others still land.
//   Meta and GA4 days are replaced whole, in one transaction per table;
//   Razorpay rows are upserted by their own ids.
//
// SECRETS (supabase secrets, never in the repository)
//   META_ADS_READ_TOKEN     system user "ruhi-funnel-reader", ads_read only
//   GA4_SERVICE_ACCOUNT     service account "ruhi-funnel-reader" (GA4 Viewer),
//                           the key JSON or its base64
//   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET   the live keys already used by checkout
//   DASHBOARD_SYNC_SECRET   shared with the vault entry the hourly job reads

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { callerIsAdmin, serviceFetch } from '../_shared/supabase.ts'
import {
  istDay,
  readGa4,
  readMeta,
  readRazorpay,
  scrub,
  syncRange,
} from '../_shared/dashboardSync.mjs'

type SourceResult = { ok: boolean; rows?: number; error?: string; ms?: number }

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isScheduler(req: Request): boolean {
  return timingSafeEqual(req.headers.get('x-dashboard-sync-secret') ?? '', env('DASHBOARD_SYNC_SECRET') ?? '')
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await serviceFetch(path, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`database ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function replaceDays(table: string, from: string, to: string, rows: unknown[]): Promise<number> {
  const n = await rest('/rest/v1/rpc/dash_replace_days', {
    method: 'POST',
    body: JSON.stringify({ p_table: table, p_from: from, p_to: to, p_rows: rows }),
  })
  return Number(n) || 0
}

async function upsert(table: string, rows: unknown[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    await rest(`/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    })
  }
  return rows.length
}

async function linkSettlements(links: { payment_id: string; settlement_id: string; settled_at: string | null }[]) {
  const bySettlement = new Map<string, { at: string | null; ids: string[] }>()
  for (const l of links) {
    if (!/^[A-Za-z0-9_]+$/.test(l.payment_id) || !/^[A-Za-z0-9_]+$/.test(l.settlement_id)) continue
    const g = bySettlement.get(l.settlement_id) ?? { at: l.settled_at, ids: [] }
    g.ids.push(l.payment_id)
    bySettlement.set(l.settlement_id, g)
  }
  for (const [settlementId, g] of bySettlement) {
    for (let i = 0; i < g.ids.length; i += 100) {
      await rest(`/rest/v1/dash_rzp_payments?id=in.(${g.ids.slice(i, i + 100).join(',')})`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ settlement_id: settlementId, settled_at: g.at }),
      })
    }
  }
}

async function timed(fn: () => Promise<number>): Promise<SourceResult> {
  const t0 = Date.now()
  try {
    const rows = await fn()
    return { ok: true, rows, ms: Date.now() - t0 }
  } catch (error) {
    console.warn('[dashboard-sync]', scrub(String((error as Error)?.message ?? error)))
    return { ok: false, error: scrub(String((error as Error)?.message ?? error)), ms: Date.now() - t0 }
  }
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  const scheduler = isScheduler(req)
  if (!scheduler && !(await callerIsAdmin(req.headers.get('authorization')))) {
    return fail(401, 'Only the store owner or the hourly job may refresh the dashboard.')
  }
  const body = await readJson(req)

  // One run at a time: a run that started in the last 3 minutes and has not
  // finished means "already refreshing".
  const recent = (await rest(
    '/rest/v1/dash_sync_runs?select=id,started_at,finished_at,ok&order=started_at.desc&limit=20',
  )) as Json[]
  const running = recent.find((r) => !r.finished_at && Date.now() - Date.parse(String(r.started_at)) < 180_000)
  if (running) return json(409, { error: 'The dashboard is already refreshing. Try again in a minute.' })

  const firstRun = !recent.some((r) => r.ok === true)
  const { from, to } = syncRange({ today: istDay(), firstRun, from: body.from })

  const [run] = (await rest('/rest/v1/dash_sync_runs?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ trigger: scheduler ? 'schedule' : 'owner', range_from: from, range_to: to }),
  })) as Json[]

  const info: Json = {}
  const sources: Record<string, SourceResult> = {}

  sources.meta = await timed(async () => {
    const meta = await readMeta({ token: env('META_ADS_READ_TOKEN'), from, to })
    if (meta.account) info.meta_account = { ...meta.account, at: new Date().toISOString() }
    return (await replaceDays('dash_meta_daily', from, to, meta.daily)) +
      (await replaceDays('dash_meta_slices', from, to, meta.slices))
  })

  sources.ga4 = await timed(async () => {
    const ga4 = await readGa4({ serviceAccount: env('GA4_SERVICE_ACCOUNT'), from, to })
    return (await replaceDays('dash_ga4_daily', from, to, ga4.daily)) +
      (await replaceDays('dash_ga4_items', from, to, ga4.items)) +
      (await replaceDays('dash_ga4_ab', from, to, ga4.ab))
  })

  sources.razorpay = await timed(async () => {
    const rzp = await readRazorpay({ keyId: env('RAZORPAY_KEY_ID'), keySecret: env('RAZORPAY_KEY_SECRET'), from, to })
    const n = (await upsert('dash_rzp_payments', rzp.payments)) +
      (await upsert('dash_rzp_refunds', rzp.refunds)) +
      (await upsert('dash_rzp_settlements', rzp.settlements))
    await linkSettlements(rzp.links)
    return n
  })

  const ok = Object.values(sources).every((s) => s.ok)
  await rest(`/rest/v1/dash_sync_runs?id=eq.${Number(run?.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ finished_at: new Date().toISOString(), ok, sources, info }),
  })

  return json(ok ? 200 : 207, { ok, from, to, sources })
}

serve(handle)
