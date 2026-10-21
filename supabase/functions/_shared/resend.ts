// Sending one email through Resend.
//
// The mail key is read here and nowhere else. It lives in Edge Function
// secrets (`supabase secrets set RESEND_API_KEY=...`), so it exists only
// inside the Edge Function runtime — never in the Vite bundle, never in
// `localStorage`, never in this repository.
//
// Every order mail goes through this module, so the one place that decides
// "the From address", "the key" and "what a refusal means" is this file.

import { env, MissingConfigError, requireEnv } from './env.ts'

/**
 * Resend needs a From address on a verified domain. `onboarding@resend.dev`
 * works out of the box during Resend's own onboarding, but it can ONLY reach
 * the account's own address — so until `RESEND_FROM` is set to a verified
 * domain, customer confirmations are refused by Resend and the claim is rolled
 * back rather than lost. That is why the callers report honestly instead of
 * pretending a message went out.
 */
export const DEFAULT_FROM = 'Ruhi Collection <onboarding@resend.dev>'

export interface Mail {
  /** One recipient, or several. */
  to: string | string[]
  subject: string
  /** The body. Plain text — the shop's own words, never markup. */
  text: string
  /** The address a reply should go to. */
  replyTo?: string
}

/**
 * A refusal from Resend that is not a bad key.
 *
 * The status is carried so the caller can say what went wrong without
 * guessing — 403 in particular is Resend's way of saying "this sender may
 * not write to this recipient", which is what happens while the From address
 * is still `onboarding@resend.dev`.
 */
export class ResendError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`resend-refused:${status}`)
    this.name = 'ResendError'
    this.status = status
  }
}

/**
 * Send one email.
 *
 * Throws {@link MissingConfigError} when Resend refuses our key (a fault on
 * this server — never something the shopper can fix), and a {@link ResendError}
 * for anything else. It never returns quietly after a failure: a caller that
 * believes a mail went out when it did not is worse than a logged error.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = requireEnv('RESEND_API_KEY')
  const from = env('RESEND_FROM') ?? DEFAULT_FROM

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: Array.isArray(mail.to) ? mail.to : [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
  })

  if (res.ok) return
  if (res.status === 401) throw new MissingConfigError(['RESEND_API_KEY'])
  // The body says why, in Resend's own words, and it holds no secret — it is
  // written to the function's log so the owner can see what to fix.
  const detail = await res.text().catch(() => '')
  console.warn('[resend] answered', res.status, detail.slice(0, 300))
  throw new ResendError(res.status)
}
