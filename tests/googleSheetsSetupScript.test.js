// The dedicated Google Sheets OAuth client.
//
// These tests pin the separation that keeps the storefront's own Google
// sign-in safe: the setup script must never read or write Supabase Auth's
// Google configuration, must ask for the Sheets Client ID and Client secret
// at hidden prompts, must have Google verify the pair BEFORE storing
// anything, and must never print the secret.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  REDIRECT_URI,
  REQUIRED_SECRETS,
  askHidden,
  probeProblemLines,
  secretPayload,
  validateClientCredentials,
} from '../scripts/google-sheets-setup.mjs'
import {
  missingConfigMessage,
  setupLinks,
} from '../supabase/functions/_shared/googleOAuth.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const script = read('scripts/google-sheets-setup.mjs')

const VALID_ID = '123456789012-dedicatedsheetsclient.apps.googleusercontent.com'
const VALID_SECRET = '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-printed'

// ---------------------------------------------------------------------------
// 1. The values are checked before Google is asked
// ---------------------------------------------------------------------------

test('a dedicated Client ID and secret are accepted, trimmed, and never echoed', () => {
  const checked = validateClientCredentials(`  ${VALID_ID}  `, `  ${VALID_SECRET}  `)
  assert.equal(checked.ok, true)
  assert.equal(checked.clientId, VALID_ID)
  assert.equal(checked.clientSecret, VALID_SECRET)
})

test('a swapped pair is refused without printing the secret', () => {
  const swapped = validateClientCredentials(VALID_SECRET, VALID_ID)
  assert.equal(swapped.ok, false)
  assert.equal(swapped.field, 'client_secret')
  assert.match(swapped.message, /Client ID, not a Client secret/i)
  assert.doesNotMatch(swapped.message, new RegExp(VALID_SECRET))
  assert.doesNotMatch(swapped.message, new RegExp(VALID_ID))
})

test('empty, identical and malformed values are refused', () => {
  for (const [id, secret] of [
    ['', VALID_SECRET],
    [VALID_ID, ''],
    [VALID_ID, VALID_ID],
    ['123456789012', VALID_SECRET],
    [VALID_ID, 'short'],
  ]) {
    const checked = validateClientCredentials(id, secret)
    assert.equal(checked.ok, false, `${id || '(empty)'} / ${secret ? 'secret' : '(empty)'} must be refused`)
    assert.ok(checked.message.length > 10)
    assert.doesNotMatch(checked.message, /GOCSPX-/)
  }
})

test('the Management API payload uses exactly the two dedicated secret names', () => {
  const payload = secretPayload(VALID_ID, VALID_SECRET)
  assert.deepEqual(payload.map((s) => s.name), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
  assert.equal(payload[0].value, VALID_ID)
  assert.equal(payload[1].value, VALID_SECRET)
  assert.throws(() => secretPayload('bad', VALID_SECRET), /apps\.googleusercontent\.com/)
})

// ---------------------------------------------------------------------------
// 2. What the owner is told when Google says no
// ---------------------------------------------------------------------------

test('a refused pair sends the owner back to the setup script, not Auth settings', () => {
  const lines = probeProblemLines({ reason: 'invalid_secret' }).join('\n')
  assert.match(lines, /node scripts\/google-sheets-setup\.mjs/)
  assert.match(lines, /dedicated/i)
  assert.doesNotMatch(lines, /Authentication\s*→\s*Sign In/)
  assert.doesNotMatch(lines, /GOCSPX-/)
})

test('an unregistered callback gets the exact URL and is not stored', () => {
  const lines = probeProblemLines({ reason: 'redirect_not_registered' }).join('\n')
  assert.match(lines, new RegExp(REDIRECT_URI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(lines, /nothing was stored|NOT stored|Authorised redirect URIs/i)
  assert.match(lines, /node scripts\/google-sheets-setup\.mjs/)
})

test('an unreachable Google means nothing is stored', () => {
  const lines = probeProblemLines({ reason: 'unreachable' }).join('\n')
  assert.match(lines, /NOT stored/i)
  assert.match(lines, /node scripts\/google-sheets-setup\.mjs/)
})

// ---------------------------------------------------------------------------
// 3. The hidden prompts and the ordering inside the script
// ---------------------------------------------------------------------------

test('both dedicated values are read at hidden prompts', () => {
  assert.equal(typeof askHidden, 'function')
  assert.match(script, /askHidden\(' {4}Sheets Client ID \(typed, not shown\): '\)/)
  assert.match(script, /askHidden\(' {4}Sheets Client secret \(typed, not shown\): '\)/)
  // The hidden prompt switches echo off on a terminal.
  assert.match(script, /setRawMode\(true\)/)
  assert.match(script, /setRawMode\(false\)/)
})

test('Google verifies the pair before any secret is stored', () => {
  const verifyAt = script.indexOf('const probe = await probeGoogleSetup')
  const storeAt = script.indexOf("method: 'POST'")
  assert.ok(verifyAt > 0, 'the script probes Google')
  assert.ok(storeAt > verifyAt, 'the POST that stores the secrets comes after the probe')
  assert.match(script, /if \(!probe\.secretValid \|\| !probe\.redirectRegistered \|\| !probe\.ok\)/)
  assert.match(script, /Nothing has been stored yet/)
})

test('the script never reads or changes Supabase Auth Google settings', () => {
  assert.doesNotMatch(script, /\/config\/auth/)
  assert.doesNotMatch(script, /external_google/i)
  assert.doesNotMatch(script, /Authentication\s*→\s*Sign In/)
  assert.doesNotMatch(script, /PATCH/)
})

test('the script stores the two names the Edge Functions read', () => {
  assert.deepEqual(REQUIRED_SECRETS, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY'])
  assert.match(script, /secretPayload\(checked\.clientId, checked\.clientSecret\)/)
  assert.match(script, /GOOGLE_TOKEN_KEY is present and will not be changed/)
})

test('no line that prints output can contain the secret', () => {
  const outputLines = script.split('\n').filter((line) =>
    /\b(console\.(?:log|error|warn)|info|ok|bad)\s*\(/.test(line))
  for (const line of outputLines) {
    assert.doesNotMatch(line, /\b(?:clientSecret|typedSecret|checked\.clientSecret)\b/,
      `this output line names the secret variable: ${line.trim()}`)
  }
  // No shortened secret, no hash of the secret, no length of the secret.
  assert.doesNotMatch(script, /clientSecret\.slice|typedSecret\.slice/)
  assert.doesNotMatch(script, /createHash|fingerprint/i)
  assert.doesNotMatch(script, /clientSecret\.length/)
  // No secret in a URL or in a shell argument.
  assert.doesNotMatch(script, /execFileSync\([^)]*clientSecret/s)
})

test('--check only reads names; --set-secret keeps the old command working', () => {
  assert.match(script, /argv\.includes\('--check'\)/)
  assert.match(script, /const check = argv\.includes\('--check'\)/)
  assert.match(script, /Supabase returns these values masked/)
  // --set-secret is documented as an alias of the default flow.
  assert.match(script, /--set-secret/)
})

// ---------------------------------------------------------------------------
// 4. The Edge Functions still read the dedicated secrets, never Auth's
// ---------------------------------------------------------------------------

test('the callback and every Sheets function use GOOGLE_CLIENT_ID/SECRET', () => {
  const files = [
    'supabase/functions/google-sheets-callback/index.ts',
    'supabase/functions/google-sheets/index.ts',
    'supabase/functions/_shared/googleConnection.ts',
  ]
  for (const file of files) {
    const code = read(file)
    assert.match(code, /GOOGLE_CLIENT_ID/, `${file} reads GOOGLE_CLIENT_ID`)
    assert.match(code, /GOOGLE_CLIENT_SECRET/, `${file} reads GOOGLE_CLIENT_SECRET`)
    assert.doesNotMatch(code, /external_google/i, `${file} does not use Auth's Google client`)
  }
})

// ---------------------------------------------------------------------------
// 5. The admin panel's setup text points at the dedicated client
// ---------------------------------------------------------------------------

test('the setup message uses the dedicated script and never asks for an Auth change', () => {
  const generic = missingConfigMessage(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
    redirectUri: REDIRECT_URI,
  }).join('\n')
  assert.match(generic, /Google Sheets API/)
  assert.match(generic, /Google Drive API/)
  assert.match(generic, /node scripts\/google-sheets-setup\.mjs/)
  assert.match(generic, /hidden prompts/i)
  assert.match(generic, /DEDICATED/)
  assert.match(generic, new RegExp(REDIRECT_URI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(generic, /Authentication\s*→\s*Sign In/)
  assert.doesNotMatch(generic, /paste it as the Client Secret/i)

  const invalid = missingConfigMessage([], {
    reason: 'invalid_secret',
    redirectUri: REDIRECT_URI,
  }).join('\n')
  assert.match(invalid, /node scripts\/google-sheets-setup\.mjs/)
  assert.doesNotMatch(invalid, /Authentication\s*→\s*Sign In/)
  assert.match(invalid, /separate OAuth client/i)

  const links = setupLinks(VALID_ID)
  const hint = links.map((l) => l.hint).join('\n')
  assert.match(hint, /node scripts\/google-sheets-setup\.mjs/)
  assert.doesNotMatch(hint, /Authentication\s*→\s*Sign In/)
})
