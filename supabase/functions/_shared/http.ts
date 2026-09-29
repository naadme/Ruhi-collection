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
    return new Response('ok', { status: 204, headers: CORS })
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
