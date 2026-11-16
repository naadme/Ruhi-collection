#!/usr/bin/env node
/**
 * Set up the DEDICATED Google Sheets OAuth client for Ruhi Collections.
 *
 *   node scripts/google-sheets-setup.mjs              type both values, verify, store
 *   node scripts/google-sheets-setup.mjs --check      only check which secrets exist
 *   node scripts/google-sheets-setup.mjs --set-secret kept for old instructions — same as above
 *
 * The Google Sheets integration must NOT reuse the OAuth client that the
 * storefront's own "Continue with Google" sign-in uses. This script therefore
 * never reads and never writes Supabase Authentication's Google provider. It
 * asks for a separate Sheets Client ID and Client secret, has Google verify
 * the pair and the callback URL, and only then stores them as the Edge
 * Function secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
 *
 * The Client secret is typed at a hidden prompt. It is never printed, never
 * logged, never written to disk, and never put in a URL.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  probeGoogleSetup,
  SETUP_SCOPES,
  setupLinks,
} from '../supabase/functions/_shared/googleOAuth.mjs'

export const PROJECT_REF = 'xhsjwhzutalckeektluj'
export const CALLBACK_PATH = '/functions/v1/google-sheets-callback'
export const REDIRECT_URI = `https://${PROJECT_REF}.supabase.co${CALLBACK_PATH}`
export const CONSOLE_CREDENTIALS = 'https://console.cloud.google.com/apis/credentials'
export const CONSOLE_BRANDING = 'https://console.cloud.google.com/auth/branding'
export const ADMIN_CONNECT_URL = 'https://www.ruhi-collections.com/admin?section=orders&connect=1'

/** The exact secrets every Sheets function reads. */
export const REQUIRED_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)
const info = (m) => console.log(`    ${m}`)
const head = (m) => console.log(`\n${m}`)

/**
 * Validate the shape of the two values WITHOUT ever quoting the secret.
 * A wrong value is usually a swap or a half-copied line, and both are worth
 * catching before Google is asked.
 */
export function validateClientCredentials(clientId, clientSecret) {
  const id = String(clientId ?? '').trim()
  const secret = String(clientSecret ?? '').trim()

  if (!id) return { ok: false, field: 'client_id', message: 'The Google Sheets Client ID is empty.' }
  if (!secret) return { ok: false, field: 'client_secret', message: 'The Google Sheets Client secret is empty.' }
  if (id === secret) {
    return { ok: false, field: 'client_secret', message: 'The Client ID and Client secret are the same value — they were probably pasted into the wrong prompts.' }
  }
  if (secret.toLowerCase().endsWith(CLIENT_ID_SUFFIX)) {
    return { ok: false, field: 'client_secret', message: 'That is a Client ID, not a Client secret. Copy the secret from the same OAuth client.' }
  }
  if (id.toLowerCase().endsWith(CLIENT_ID_SUFFIX) === false) {
    return { ok: false, field: 'client_id', message: `A Google OAuth Client ID ends with ${CLIENT_ID_SUFFIX}. Copy the “Client ID” line, not the project number.` }
  }
  if (secret.length < 10) {
    return { ok: false, field: 'client_secret', message: 'That Client secret is too short. Copy the whole value from Google Cloud.' }
  }
  return { ok: true, clientId: id, clientSecret: secret }
}

/** The Management API payload. The secret only ever travels in this object. */
export function secretPayload(clientId, clientSecret) {
  const checked = validateClientCredentials(clientId, clientSecret)
  if (!checked.ok) throw new Error(checked.message)
  return [
    { name: 'GOOGLE_CLIENT_ID', value: checked.clientId },
    { name: 'GOOGLE_CLIENT_SECRET', value: checked.clientSecret },
  ]
}

/**
 * What to do when Google says no. The lines contain no secret and no value
 * copied from the prompt.
 */
export function probeProblemLines(probe, redirectUri = REDIRECT_URI) {
  if (probe?.reason === 'invalid_secret') {
    return [
      'Google refused the Client ID + Client secret pair.',
      'They must come from the SAME dedicated “Web application” OAuth client.',
      `1. Open ${CONSOLE_CREDENTIALS}`,
      '2. Open that Sheets client (not the website sign-in client).',
      '3. Copy its Client ID and its CURRENT Client secret — regenerate the secret if needed.',
      '4. Run: node scripts/google-sheets-setup.mjs',
    ]
  }
  if (probe?.reason === 'redirect_not_registered') {
    return [
      'Google does not accept the Sheets callback URL for this client.',
      '1. Open the dedicated Sheets “Web application” OAuth client.',
      '2. Under “Authorised redirect URIs” → Add → paste exactly:',
      `      ${redirectUri}`,
      '3. Save, then run: node scripts/google-sheets-setup.mjs',
    ]
  }
  if (probe?.reason === 'unreachable') {
    return [
      'Google could not be reached, so the credentials were NOT stored.',
      'Check the network connection and run: node scripts/google-sheets-setup.mjs',
    ]
  }
  return [
    'Google did not confirm the credentials, so nothing was stored.',
    'Check the dedicated Sheets OAuth client in Google Cloud and run:',
    '    node scripts/google-sheets-setup.mjs',
  ]
}

/** A hidden prompt, so neither value appears on screen or in shell history. */
let pipedLines = null

function nextPipedLine() {
  if (pipedLines === null) {
    try {
      pipedLines = readFileSync(0, 'utf8').split(/\r?\n/)
    } catch {
      pipedLines = []
    }
  }
  return pipedLines.length ? pipedLines.shift().trim() : ''
}

export function askHidden(question) {
  return new Promise((resolvePromise) => {
    if (!process.stdin.isTTY) {
      // Piped input cannot disable echo, but the value is still never printed
      // by this script. Read every line once so two prompts cannot consume
      // each other's buffered input.
      process.stdout.write(question)
      const line = nextPipedLine()
      process.stdout.write('\n')
      resolvePromise(line)
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
          cleanup(); process.stdout.write('\n'); resolvePromise(buf); return
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

function readManagementToken() {
  const fromEnv = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim()
  if (fromEnv) return fromEnv
  try {
    return execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function apiFor(token) {
  return (path, init = {}) => fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

async function secretNames(api) {
  const res = await api('/secrets')
  if (!res.ok) return { ok: false, status: res.status, names: [] }
  const body = await res.json().catch(() => [])
  return {
    ok: true,
    status: res.status,
    names: (Array.isArray(body) ? body : []).map((s) => String(s?.name || '')).filter(Boolean),
  }
}

/** Read-only mode: the values are masked by Supabase, so only names are shown. */
async function checkOnly(api) {
  head('2. Edge Function secrets on this project')
  const listed = await secretNames(api)
  if (!listed.ok) {
    bad(`Could not read the secrets (${listed.status}).`)
    return false
  }
  for (const name of REQUIRED_SECRETS) {
    console.log(`    ${listed.names.includes(name) ? '\u2713' : '\u2717'} ${name}`)
  }
  const missing = REQUIRED_SECRETS.filter((name) => !listed.names.includes(name))
  if (missing.length) {
    bad(`Missing: ${missing.join(', ')}`)
    if (missing.includes('GOOGLE_TOKEN_KEY')) {
      info('Create a long random key (keep it — existing connections are encrypted with it):')
      info('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"')
      info(`  npx -y supabase@latest secrets set --project-ref ${PROJECT_REF} GOOGLE_TOKEN_KEY=<that value>`)
    }
    if (missing.some((n) => n !== 'GOOGLE_TOKEN_KEY')) {
      info('Run this script WITHOUT --check to enter and verify the dedicated Sheets client:')
      info('  node scripts/google-sheets-setup.mjs')
    }
    return false
  }

  ok('All required secret names are present')
  info('Supabase returns these values masked, so --check cannot test the pair.')
  info('Run without --check to enter the dedicated Client ID + secret and have Google verify them:')
  info('  node scripts/google-sheets-setup.mjs')
  return true
}

/** The whole flow. Exported so the test suite can exercise the pieces. */
export async function main({ argv = process.argv.slice(2) } = {}) {
  const check = argv.includes('--check')

  console.log('Ruhi Collections — Google Sheets setup')
  info(`project: ${PROJECT_REF}`)
  info(`callback: ${REDIRECT_URI}`)

  head('1. Use a DEDICATED Google Sheets OAuth client')
  info('This is a separate “Web application” OAuth client from the one the website')
  info('uses for “Continue with Google”. This script never reads or changes')
  info('Supabase Authentication, so the website sign-in is left exactly as it is.')
  info(`Register this exact redirect URI on the dedicated client:\n    ${REDIRECT_URI}`)

  const token = readManagementToken()
  if (!token) {
    bad('No Supabase access token was found (keychain service “Supabase CLI” or SUPABASE_ACCESS_TOKEN).')
    return false
  }
  const api = apiFor(token)

  if (check) return checkOnly(api)

  const listed = await secretNames(api)
  if (!listed.ok) {
    bad(`Could not read the Edge Function secrets (${listed.status}).`)
    return false
  }
  if (!listed.names.includes('GOOGLE_TOKEN_KEY')) {
    bad('GOOGLE_TOKEN_KEY is missing, so an encrypted Google connection could not be stored.')
    info('Create a long random key (keep it unchanged if you already have one):')
    info('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"')
    info(`  npx -y supabase@latest secrets set --project-ref ${PROJECT_REF} GOOGLE_TOKEN_KEY=<that value>`)
    info('Then run: node scripts/google-sheets-setup.mjs')
    return false
  }
  ok('GOOGLE_TOKEN_KEY is present and will not be changed')

  // ---- the dedicated values, typed with echo off --------------------------
  head('2. The dedicated Sheets Client ID and Client secret')
  info('Both prompts are hidden — neither value is echoed, logged or written to disk.')
  const typedId = await askHidden('    Sheets Client ID (typed, not shown): ')
  const typedSecret = await askHidden('    Sheets Client secret (typed, not shown): ')
  const checked = validateClientCredentials(typedId, typedSecret)
  if (!checked.ok) {
    bad(checked.message)
    info(`Open ${CONSOLE_CREDENTIALS} → the dedicated Sheets “Web application” client.`)
    info('Then run: node scripts/google-sheets-setup.mjs')
    return false
  }
  ok('Both values were read without echoing them')

  // ---- verify with Google BEFORE anything is stored ------------------------
  head('3. Verify the pair and the callback URL with Google')
  const probe = await probeGoogleSetup({
    clientId: checked.clientId,
    clientSecret: checked.clientSecret,
    redirectUri: REDIRECT_URI,
  })
  if (!probe.secretValid || !probe.redirectRegistered || !probe.ok) {
    for (const line of probeProblemLines(probe)) info(line)
    return false
  }
  ok('Google accepts this Client ID + Client secret pair')
  ok('The Sheets callback URL is registered for this client')
  info('Nothing has been stored yet — the pair is proven first.')

  // ---- only now store the two Edge secrets --------------------------------
  head('4. Store the dedicated credentials as Edge Function secrets')
  const saved = await api('/secrets', {
    method: 'POST',
    body: JSON.stringify(secretPayload(checked.clientId, checked.clientSecret)),
  })
  if (!saved.ok) {
    bad(`Could not store the secrets (${saved.status}). Nothing from the prompts is shown here.`)
    return false
  }
  ok('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are stored')
  info('The website’s Google sign-in configuration was not touched.')

  // ---- confirm by name, never by value ------------------------------------
  head('5. The Edge Function has everything it needs')
  const after = await secretNames(api)
  if (!after.ok) {
    bad(`Could not re-read the secret names (${after.status}).`)
    return false
  }
  let complete = true
  for (const name of REQUIRED_SECRETS) {
    const present = after.names.includes(name)
    console.log(`    ${present ? '\u2713' : '\u2717'} ${name}`)
    if (!present) complete = false
  }
  if (!complete) return false

  // ---- what is left --------------------------------------------------------
  head('6. What is left')
  ok('The dedicated Sheets credentials are verified and stored.')
  info('Deploy the Sheets functions once so they run the current code:')
  info(`  npx -y supabase@latest functions deploy google-sheets-callback --project-ref ${PROJECT_REF} --no-verify-jwt`)
  info(`  npx -y supabase@latest functions deploy google-sheets --project-ref ${PROJECT_REF}`)
  info(`  npx -y supabase@latest functions deploy google-sheets-sync --project-ref ${PROJECT_REF} --no-verify-jwt`)
  info('Then connect the owner’s Google account:')
  info(`  ${ADMIN_CONNECT_URL}`)
  info('Approve the access once. The spreadsheet will be created and shared with')
  info('ruhicollections2026@gmail.com. If an old connection shows as expired, press')
  info('“Connect Google Sheets” again — the new credentials are used from then on.')
  info('Consent screen scopes:')
  for (const scope of SETUP_SCOPES) info(`  ${scope}`)
  info(`More detail: ${setupLinks(checked.clientId)[0]?.url || CONSOLE_BRANDING}`)
  return true
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().then((success) => {
    if (!success) process.exitCode = 1
  }).catch(() => {
    // Deliberately generic: an unexpected error must never print a value
    // that was typed at a hidden prompt.
    console.error('  \u2717 The setup could not finish. Nothing containing the Client secret was printed.')
    process.exitCode = 1
  })
}
