// send-contact-email
//
// Delivers the contact form to the shop's inbox and keeps the row the
// storefront has always written to `public.contact_messages`.
//
// The browser sends four plain strings — name, email, phone, comment — and
// nothing else. The recipient, subject and body are decided here, so a
// tampered client can never turn this into a mail relay. `RESEND_API_KEY`
// lives only in Edge Function secrets; nothing in this file is part of the
// Vite bundle.

import { serve } from '../_shared/deno.ts'
import { env, MissingConfigError, requireEnv } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { serviceFetch } from '../_shared/supabase.ts'

/** The one mailbox that receives contact form submissions. */
const TO = 'ruhicollections2026@gmail.com'

const SUBJECT = 'New Contact Form Submission — Ruhi Collection'

/**
 * Resend needs a From address on a verified domain. `onboarding@resend.dev`
 * works out of the box during Resend's own onboarding (it can only reach the
 * account's own address); once a domain is verified, set `RESEND_FROM` to
 * something like `Ruhi Collection <hello@yourdomain.com>`.
 */
const DEFAULT_FROM = 'Ruhi Collection <onboarding@resend.dev>'

const NOT_CONFIGURED =
  'Our contact form is unavailable right now. Please email us directly.'
const GENERIC = 'We could not send your message. Please try again in a moment.'
const TOO_MANY =
  'That is a lot of messages in a short time. Please wait a few minutes and try again.'

/** Mirrors the limits the contact form itself enforces. */
const NAME_MIN = 2
const NAME_MAX = 120
const EMAIL_MAX = 254
const COMMENT_MIN = 5
const COMMENT_MAX = 2000
const PHONE_MAX = 30

/** Refuse oversized bodies before parsing them. */
const MAX_BODY_BYTES = 16_000

/** Same sender, same message, within this window → do not store it twice. */
const DEDUPE_MS = 10 * 60 * 1000

/** A single address may not send more than this many messages per hour. */
const MAX_PER_HOUR = 5

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[0-9+()\-\s]+$/

interface Submission {
  name: string
  email: string
  phone: string
  comment: string
}

type Checked = { submission: Submission } | { invalid: string }

/** Field-by-field validation — the same rules the browser applies first. */
function check(body: Json): Checked {
  const name = asString(body.name)
  const email = asString(body.email)
  const phone = asString(body.phone)
  const comment = asString(body.comment)

  if (phone && (phone.length > PHONE_MAX || !PHONE_RE.test(phone))) {
    return { invalid: 'Please enter a valid phone number.' }
  }
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { invalid: 'Please enter your name.' }
  }
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { invalid: 'Please enter a valid email address.' }
  }
  if (comment.length < COMMENT_MIN || comment.length > COMMENT_MAX) {
    return { invalid: 'Please tell us how we can help.' }
  }
  return { submission: { name, email, phone, comment } }
}

/**
 * Messages this address sent in the last hour.
 *
 * `null` means the ledger could not be read — a contact form must not go dark
 * because a bookkeeping call failed, so the caller treats that as "no history"
 * rather than as an error.
 */
async function recentRows(email: string, sinceIso: string): Promise<Json[] | null> {
  try {
    const res = await serviceFetch(
      `/rest/v1/contact_messages?email=eq.${encodeURIComponent(email)}` +
        `&created_at=gte.${encodeURIComponent(sinceIso)}` +
        '&select=id,comment,created_at&limit=20',
    )
    if (!res.ok) return null
    const rows: unknown = await res.json().catch(() => null)
    return Array.isArray(rows) ? (rows as Json[]) : null
  } catch {
    return null
  }
}

/** Store the message. A failure is logged, never surfaced to the shopper. */
async function save(submission: Submission): Promise<void> {
  try {
    const res = await serviceFetch('/rest/v1/contact_messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(submission),
    })
    if (!res.ok) console.warn('[send-contact-email] message not stored:', res.status)
  } catch (error) {
    console.warn('[send-contact-email] message not stored:', String(error))
  }
}

/**
 * Send the notification email.
 *
 * Throws {@link MissingConfigError} when Resend rejects our key (a fault on
 * this server — never something the shopper can fix), and a plain Error for
 * anything else. The recipient and subject are constants: the payload the
 * browser sent cannot influence either.
 */
async function deliver(submission: Submission): Promise<void> {
  const apiKey = requireEnv('RESEND_API_KEY')
  const from = env('RESEND_FROM') ?? DEFAULT_FROM
  const text = [
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    `Phone: ${submission.phone}`,
    `Message: ${submission.comment}`,
    '',
    `Received: ${new Date().toISOString()}`,
  ].join('\n')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [TO],
      reply_to: submission.email,
      subject: SUBJECT,
      text,
    }),
  })

  if (res.ok) return
  if (res.status === 401 || res.status === 403) {
    throw new MissingConfigError(['RESEND_API_KEY'])
  }
  console.warn('[send-contact-email] Resend answered', res.status)
  throw new Error('resend-rejected')
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return fail(413, 'Your message is too long.')
    }

    const checked = check(await readJson(req))
    if ('invalid' in checked) return fail(400, checked.invalid)
    const submission = checked.submission

    // Fail before anything is stored: an unconfigured function must not leave
    // messages behind that no one will ever be told about.
    requireEnv('RESEND_API_KEY')

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = await recentRows(submission.email, since)
    if (rows && rows.length >= MAX_PER_HOUR) return fail(429, TOO_MANY)

    // A retry after a failed send repeats the same text minutes later; storing
    // it twice would put the same enquiry in the ledger twice.
    const duplicate = (rows ?? []).some((row) => {
      const created = Date.parse(asString(row.created_at))
      return (
        asString(row.comment) === submission.comment &&
        Number.isFinite(created) &&
        Date.now() - created <= DEDUPE_MS
      )
    })
    if (!duplicate) await save(submission)

    await deliver(submission)

    return json(200, { ok: true })
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(503, NOT_CONFIGURED)
    console.warn('[send-contact-email] delivery failed:', String(error))
    return fail(502, GENERIC)
  }
}

serve(handle)
