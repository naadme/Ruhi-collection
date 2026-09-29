#!/usr/bin/env node
/**
 * Diagnose "Unable to exchange external code" (server_error /
 * unexpected_failure) when signing in with Google.
 *
 *   node scripts/check-google-oauth.mjs
 *
 * The browser side of the flow is provably fine when this error appears:
 * Supabase handed Google a valid Client ID and a registered callback URI, and
 * Google handed back an authorisation code. What fails is the *next* hop —
 * Supabase trading that code for tokens — which only ever fails when the
 * Client Secret saved in Authentication → Providers → Google does not match
 * the Client ID that Supabase actually uses.
 *
 * This script checks each link in that chain and prints the one that is
 * broken. The secret is only ever sent to Google's token endpoint; it is
 * never printed and never written to disk.
 *
 * Reads VITE_SUPABASE_URL from .env when present. Client ID and Secret are
 * taken from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET if exported, otherwise
 * you are prompted (the secret is typed with echo off).
 */
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------------------------------------------------------- helpers */

const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => console.log(`  ✗ ${m}`)
const info = (m) => console.log(`    ${m}`)
const head = (m) => console.log(`\n${m}`)

function readEnvFile() {
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8')
    const out = {}
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolveP) => {
    if (hidden && !process.stdin.isTTY) {
      process.stdout.write(`${question}\n`)
      const rl = createInterface({ input: process.stdin })
      rl.once('line', (a) => { rl.close(); resolveP(a.trim()) })
      return
    }
    if (!hidden) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(question, (a) => { rl.close(); resolveP(a.trim()) })
      return
    }
    // Echo-off prompt: raw mode, collect keypresses until Enter.
    process.stdout.write(question)
    let buf = ''
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); process.exit(1) }
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          cleanup(); process.stdout.write('\n'); resolveP(buf); return
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

const title = (s) => s.replace(/\s+/g, ' ').trim()

async function main() {
  const env = { ...readEnvFile(), ...process.env }

  const supabaseUrl = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  if (!supabaseUrl) {
    bad('VITE_SUPABASE_URL is missing — add it to .env first.')
    process.exit(1)
  }

  const projectId = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0]
  console.log('Supabase ↔ Google sign-in check')
  info(`project: ${projectId}`)
  info(`callback: ${supabaseUrl}/auth/v1/callback`)

  /* 1 ─ what Supabase is actually configured with ------------------------ */

  head('1. Supabase → Google provider')
  let supabaseClientId = ''
  let supabaseCallback = ''
  {
    const res = await fetch(`${supabaseUrl}/auth/v1/authorize?provider=google`, { redirect: 'manual' })
    const location = res.headers.get('location') || ''
    if (!location.includes('accounts.google.com')) {
      bad('Supabase did not redirect to Google — the provider is not usable.')
      info(location ? `redirected to: ${location}` : `status ${res.status}`)
      info('Open Authentication → Sign In → Google, enable it and save the Client ID + Secret.')
      process.exit(1)
    }
    const u = new URL(location)
    supabaseClientId = u.searchParams.get('client_id') || ''
    supabaseCallback = u.searchParams.get('redirect_uri') || `${supabaseUrl}/auth/v1/callback`
    ok('Google provider is enabled')
    info(`client id in use: ${supabaseClientId}`)
    info(`callback in use:  ${supabaseCallback}`)
  }

  /* 2 ─ ask for the credentials they can see in Google Cloud -------------- */

  head('2. Credentials from Google Cloud Console')
  info('Google Cloud → APIs & Services → Credentials → the "Web application"')
  info(`client whose Client ID is exactly:\n    ${supabaseClientId}`)

  const clientId = (env.GOOGLE_CLIENT_ID || (await ask('  Client ID:  '))).trim()
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || (await ask('  Client secret: ', { hidden: true }))).trim()

  if (!clientId || !clientSecret) {
    bad('Both a Client ID and a Client secret are required for this check.')
    process.exit(1)
  }

  if (clientId !== supabaseClientId) {
    bad('The Client ID you copied is NOT the one Supabase is using.')
    info(`you gave:    ${clientId}`)
    info(`supabase uses: ${supabaseClientId}`)
    info('Either paste the matching Client ID into Supabase, or take the Client')
    info('secret from the client listed above — the pair must belong together.')
  } else {
    ok('Client ID matches the one Supabase is using')
  }

  /* 3 ─ will Google accept the callback URI for this client? ------------- */

  head('3. Google Cloud → authorised redirect URI')
  {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', supabaseCallback)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'email profile')
    const res = await fetch(url, { redirect: 'manual' })
    const location = res.headers.get('location') || ''
    const body = res.status === 200 ? await res.text() : ''
    const mismatch = res.status >= 400 || /redirect_uri_mismatch/i.test(location) || /redirect_uri_mismatch/i.test(body)
    if (mismatch) {
      bad('Google rejects this redirect URI for that client.')
      info(`add exactly: ${supabaseCallback}`)
      info('Google Cloud → APIs & Services → Credentials → Authorised redirect URIs')
    } else {
      ok(`${supabaseCallback} is registered`)
    }
  }

  /* 4 ─ does the Client ID / Client secret pair work? --------------------- */

  head('4. Google Cloud → Client ID + Client secret pair')
  {
    // A deliberately bogus code: Google validates the credentials *before*
    // it looks at the code, so a valid pair answers "invalid_grant"
    // ("your code is no good") and a bad pair answers "invalid_client".
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'supabase-oauth-probe-not-a-real-code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: supabaseCallback,
    })
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    let json = {}
    try { json = await res.json() } catch { /* non-JSON body */ }
    const err = json.error || ''

    if (err === 'invalid_grant' || (res.status === 400 && !err)) {
      ok('Google accepts this Client ID + Client secret — the pair is valid.')
      info('So Supabase is storing a different (empty, mistyped or stale) secret.')
      info(`Fix: Supabase Dashboard → Authentication → Sign In → Google → paste`)
      info('this exact Client ID and Client secret, then press Save.')
    } else if (err === 'invalid_client') {
      bad(`Google refused the credentials: ${title(json.error_description) || 'invalid_client'}`)
      info('The secret does not belong to the Client ID above.')
      info('Open that exact client in Google Cloud → Credentials and copy *its*')
      info('Client secret (Regenerate it if you cannot see the original).')
    } else if (err === 'unauthorized_client') {
      bad('That OAuth client is not allowed to use the authorization-code grant.')
      info('It must be an OAuth client of type "Web application".')
    } else {
      bad(`Unexpected answer from Google (HTTP ${res.status}): ${err || 'no error field'}`)
      info(json.error_description || '(no description)')
    }
  }

  console.log('\nIf every line above is ✓, read the real error in the logs:')
  info('Supabase Dashboard → Authentication → Logs → Auth, filter for "callback".')
  info('The line before "Unable to exchange external code" carries Google\'s reason.')
  console.log('')
}

main().catch((e) => {
  bad(e?.message || String(e))
  process.exit(1)
})
