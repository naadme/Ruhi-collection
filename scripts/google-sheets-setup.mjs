#!/usr/bin/env node
/**
 * Finish the Google Sheets setup for the Ruhi Collection admin panel.
 *
 *   node scripts/google-sheets-setup.mjs              check, and sync the secrets
 *   node scripts/google-sheets-setup.mjs --set-secret  type the Client secret, then check
 *
 * Everything it can do on its own, it does: it copies the project's existing
 * Google OAuth client into the Edge Function's secrets and tells the owner
 * exactly what Google thinks of them.
 *
 * The Client secret is read from the project's own auth configuration, or
 * typed at a hidden prompt. It is never printed, never logged and never
 * written to disk.
 */
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import crypto from 'node:crypto'

const REF = 'xhsjwhzutalckeektluj'
const REDIRECT = `https://${REF}.supabase.co/functions/v1/google-sheets-callback`
const CONSOLE_CREDENTIALS = 'https://console.cloud.google.com/apis/credentials'
const CONSOLE_BRANDING = 'https://console.cloud.google.com/auth/branding'

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)
const info = (m) => console.log(`    ${m}`)
const head = (m) => console.log(`\n${m}`)

const wantSecret = process.argv.includes('--set-secret')

/** A hidden prompt, so the secret never appears on the screen or in a shell history. */
function askHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin })
      rl.once('line', (line) => { rl.close(); resolve(line.trim()) })
      return
    }
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
          cleanup(); process.stdout.write('\n'); resolve(buf); return
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

const managementToken = execFileSync('/usr/bin/security',
  ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()

if (!managementToken) {
  bad('No Supabase access token in the keychain, so the project cannot be read.')
  process.exit(1)
}

const api = (path, init = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
})

// ---- 1. the OAuth client this project already uses -------------------------
head('1. The Google OAuth client')
const cfg = await (await api('/config/auth')).json()
let clientId = String(cfg.external_google_client_id || '')
let clientSecret = String(cfg.external_google_secret || '')

if (!clientId) {
  bad('This project has no Google OAuth client configured.')
  info('Supabase Dashboard → Authentication → Sign In → Google.')
  process.exit(1)
}
ok('Found the client this project already uses')
info(`client id: ${clientId}`)

if (wantSecret) {
  const typed = await askHidden('    Client secret (typed, not shown): ')
  if (!typed) {
    bad('No secret was given.')
    process.exit(1)
  }
  clientSecret = typed
  // Put it where the project keeps it, so the storefront's own "Continue with
  // Google" sign-in is repaired at the same time.
  const saved = await api('/config/auth', {
    method: 'PATCH',
    body: JSON.stringify({ external_google_secret: clientSecret }),
  })
  if (saved.ok) {
    ok('The secret is now the project\'s Google secret (this also repairs "Continue with Google")')
  } else {
    bad(`Could not save the secret to the project (${saved.status}).`)
  }
}

if (!clientSecret) {
  bad('The project has no Google Client secret.')
  info(`Open ${CONSOLE_CREDENTIALS} → the "Web application" client → copy its Client secret.`)
  info('Then: node scripts/google-sheets-setup.mjs --set-secret')
  process.exit(1)
}
info(`secret: ${clientSecret.slice(0, 4)}\u2026 (${clientSecret.length} characters, never shown)`)

// ---- 2. the credentials must belong together --------------------------------
head('2. Does Google accept this Client ID with this Client secret?')
let secretValid = false
{
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'ruhi-collection-setup-probe',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (json.error === 'invalid_client') {
    bad('Google refuses this pair \u2014 the secret does not belong to this client id.')
    info(`Open ${CONSOLE_CREDENTIALS} → the client whose id starts ${clientId.split('-')[0]}`)
    info('→ copy its CURRENT Client secret (regenerate it if you have to).')
    info('→ then: node scripts/google-sheets-setup.mjs --set-secret')
  } else if (json.error === 'invalid_grant') {
    secretValid = true
    ok('Google accepts the pair (it only refused the made-up code)')
  } else {
    bad(`Unexpected answer from Google: ${json.error || res.status}`)
  }
}

// ---- 3. the callback URL ----------------------------------------------------
head('3. Is the Sheets callback URL registered for this client?')
let redirectRegistered = false
{
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', REDIRECT)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email')
  const res = await fetch(url, { redirect: 'manual' })
  const location = res.headers.get('location') || ''
  const encoded = location.match(/[?&]authError=([^&]+)/)
  let reason = ''
  if (encoded) {
    try { reason = Buffer.from(decodeURIComponent(encoded[1]), 'base64').toString('utf8') } catch { reason = '' }
  }
  if (/redirect_uri_mismatch/i.test(reason) || /redirect_uri_mismatch/i.test(location)) {
    bad('Not registered \u2014 this is the one step only the account owner can do.')
    info(`Open ${CONSOLE_CREDENTIALS}`)
    info(`Open the client whose id starts ${clientId.split('-')[0]} → "Authorised redirect URIs" → Add → paste exactly:`)
    info(`    ${REDIRECT}`)
  } else {
    redirectRegistered = true
    ok('The callback URL is registered')
  }
}

// ---- 4. the secrets the function needs --------------------------------------
head('4. Copying the credentials into the Edge Function')
{
  const res = await api('/secrets', {
    method: 'POST',
    body: JSON.stringify([
      { name: 'GOOGLE_CLIENT_ID', value: clientId },
      { name: 'GOOGLE_CLIENT_SECRET', value: clientSecret },
    ]),
  })
  if (res.ok) {
    ok('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the function')
    info(`fingerprint: ${crypto.createHash('sha256').update(clientSecret).digest('hex').slice(0, 8)}`)
  } else {
    bad(`Could not set the secrets (${res.status}).`)
  }
}
{
  const list = await (await api('/secrets')).json()
  const names = (Array.isArray(list) ? list : []).map((s) => s.name)
  head('5. The function has everything it needs')
  for (const needed of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) {
    console.log(`    ${names.includes(needed) ? '\u2713' : '\u2717'} ${needed}`)
  }
}

// ---- 6. what is left --------------------------------------------------------
head('6. Where this leaves you')
if (secretValid && redirectRegistered) {
  ok('Google is ready. Open Admin → Orders and press "Connect Google Sheets".')
  info('You will sign in with your Google account, approve access, and be back.')
} else {
  info('Two things are left, and both are on pages only the account owner can open:')
  info(`  a) ${CONSOLE_CREDENTIALS} → the OAuth client → Authorised redirect URIs → Add`)
  info(`     ${REDIRECT}`)
  if (!secretValid) {
    info(`  b) ${CONSOLE_CREDENTIALS} → the same client → copy its Client secret, then run:`)
    info('     node scripts/google-sheets-setup.mjs --set-secret')
  }
  info(`  c) ${CONSOLE_BRANDING} → the consent screen: app name, your email, and yourself as a test user.`)
  info('     The scopes it must allow:')
  for (const scope of [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'email',
  ]) info(`       ${scope}`)
}
console.log('')
