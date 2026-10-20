// The daily job that keeps the owner's Google Sheet up to date.
//
// Vercel calls this once a day (see the `crons` entry in vercel.json). It
// does one thing: ask the Supabase Edge Function `google-sheets-sync` to send
// any order the sheet does not have yet, and to update the rows whose status
// has changed.
//
// It holds no credentials of its own beyond the shared secret it forwards,
// and it never touches an order. If the Supabase function cannot be reached,
// the job says so in its answer and stops — the next run tries again, and the
// orders are still in the database.
//
// The same function is called by the payment functions the moment a payment is
// verified, so this job is the safety net rather than the only path.

export default async function handler(req, res) {
  const url = process.env.SUPABASE_FUNCTIONS_URL
  const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET

  if (!url || !secret) {
    res.status(500).json({
      ok: false,
      error: 'The sheet sync is not configured on this deployment.',
      missing: [!url ? 'SUPABASE_FUNCTIONS_URL' : '', !secret ? 'GOOGLE_SHEETS_SYNC_SECRET' : ''].filter(Boolean),
    })
    return
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/google-sheets-sync`, {
      method: 'POST',
      headers: { 'x-sync-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'schedule' }),
    })
    const body = await response.json().catch(() => ({}))
    res.status(response.ok ? 200 : 502).json({ ok: !!body?.ok, ...body })
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error && error.message ? error.message : error) })
  }
}
