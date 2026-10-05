// Small HTTP helpers shared by the three Razorpay functions.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export type Json = Record<string, unknown>

export function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

/** Always `{ error }` — the only shape the storefront ever reads. */
export const fail = (status: number, error: string): Response => json(status, { error })

/** Answer a CORS preflight, or `null` when the request is a real one. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    // A 204 is a null-body status: constructing one *with* a body throws a
    // TypeError ("Invalid response status code 204"), which the runtime turns
    // into a 500 with no CORS headers — and the browser then refuses to send
    // the POST at all. The body must stay `null`.
    return new Response(null, { status: 204, headers: CORS })
  }
  return null
}

/** Parse a JSON body defensively — a malformed body must not throw. */
export async function readJson(req: Request): Promise<Json> {
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Json
  } catch {
    /* fall through to the empty body below */
  }
  return {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
