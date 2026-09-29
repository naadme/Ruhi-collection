import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

const OAUTH_NAME = { google: 'Google' }

/**
 * TEMPORARY OAuth tracing. Remove once Google sign-in is confirmed.
 *
 * Reports the *shape* of the flow only: parameter names, GoTrue error codes and
 * the user id. Never logs access tokens, refresh tokens, provider tokens or the
 * client secret.
 */
const oauthLog = (stage, detail) => {
  console.info(`[oauth] ${stage}`, detail ?? '')
}

/**
 * GoTrue writes the same error into the query *and* the hash, and the hash copy
 * arrives double-encoded (`code%3A 4%2F0A`). Un-wrap it so the reason is
 * readable and matchable.
 */
const undouble = (value) => {
  let out = value || ''
  for (let i = 0; i < 2; i += 1) {
    try { out = decodeURIComponent(out) } catch { break }
  }
  return out
}

/**
 * Parse whatever the browser came back with after a provider redirect.
 *
 * Returns `null` on an ordinary page load. Values are read here (rather than
 * inside a later effect) because the login page tidies the address as soon as
 * `ready` flips, and child effects run ahead of this provider's.
 *
 * TEMP: the result is only used for diagnostics.
 */
function readOAuthCallback() {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search.replace(/^\?/, ''))
  const names = [...new Set([...query.keys(), ...hash.keys()])]
  if (!names.length) return null
  const grab = (k) => query.get(k) || hash.get(k) || ''
  return {
    // Parameter *names* only: the hash carries the tokens themselves.
    names,
    where: window.location.hash ? 'hash' : 'query',
    error: undouble(grab('error')),
    errorCode: undouble(grab('error_code')),
    errorDescription: undouble(grab('error_description')),
    code: grab('code'),
  }
}

/**
 * Where an OAuth round-trip comes back to.
 *
 * This exact URL must also be listed in Supabase → Authentication →
 * URL Configuration → Redirect URLs, otherwise the provider refuses to return.
 */
export function authRedirectUrl() {
  return `${window.location.origin}/account`
}

/**
 * Turn a GoTrue error into a sentence a shopper can act on.
 *
 * Supabase answers with machine codes (`over_email_send_rate_limit`) and prose
 * that sometimes leaks internals. Everything the UI shows passes through here.
 */
export function friendlyAuthError(error, provider) {
  const message = typeof error === 'string' ? error : (error?.message || '')
  const code = (error && typeof error === 'object' && error.code) || ''
  const text = `${code} ${message}`
  const who = OAUTH_NAME[provider] || 'This'

  if (/provider is not enabled|provider_not_enabled|provider.*not.*supported/i.test(text)) {
    return `${who} sign-in has not been enabled yet in the Supabase dashboard.`
  }
  if (/invalid login credentials/i.test(message)) return 'That email or password is not correct.'
  if (/already registered|user already exists/i.test(message)) {
    return 'An account already exists for that email. Switch to Login instead.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'Check your inbox for a confirmation link, then try signing in again.'
  }
  if (/over_email_send_rate_limit/i.test(text)) {
    return 'Too many attempts. Please wait a moment, then try again.'
  }
  if (/rate limit/i.test(message)) return 'Too many attempts. Please wait a moment, then try again.'
  if (/weak_password|password should be at least/i.test(message)) {
    return 'Choose a password of at least 8 characters.'
  }
  if (/password/i.test(message) && /invalid|incorrect/i.test(message)) {
    return 'That password is not correct.'
  }
  if (/flow state not found|flow_state_not_found|otp.*expired|code has expired/i.test(message)) {
    return 'That code has expired. Request a new one.'
  }
  if (/anonymous sign-ins are disabled/i.test(message)) return 'That sign-in method is not available.'
  if (/fetch|network|load failed/i.test(message)) {
    return 'We could not reach the server. Check your connection and try again.'
  }

  return message || 'Something went wrong. Please try again.'
}

// Session + authorisation for the /admin dashboard.
// Signing in is *not* enough to be an admin: `public.admins` is an allowlist
// row, so a customer who registers through Supabase Auth gains nothing.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  // Re-check the allowlist whenever the signed-in identity changes.
  //
  // There is deliberately no `profiles` row to create on sign-in (nothing in
  // this app depends on one), so this lookup is the only "did the account land
  // in the database" check that runs after an OAuth round-trip. TEMP logging.
  useEffect(() => {
    if (!user) { setIsAdmin(false); return }
    let alive = true
    supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        setIsAdmin(!error && !!data)
        oauthLog('profile lookup', error
          ? { failed: error.message }
          : { adminRow: !!data, note: 'no profile row is created by this app' })
      })
      .catch((e) => { if (alive) oauthLog('profile lookup threw', e?.message || '') })
    return () => { alive = false }
  }, [user])

  // Restores the session on a hard refresh, then keeps it in sync. Supabase
  // persists the tokens itself; this is only the React-side reflection.
  //
  // `getSession()` awaits supabase-js's one-shot `_initialize()`, which is what
  // reads `#access_token=` / `?code=` off the incoming OAuth URL. `ready` is
  // therefore only set once that has finished — anything that wants to touch
  // the callback URL must wait for it.
  // Captured on mount, while the callback URL is still untouched.
  const oauthCallback = useRef(null)
  const oauthCallbackHandled = useRef(false)

  useEffect(() => {
    let alive = true
    oauthCallback.current = readOAuthCallback()

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!alive) return
        // `_initialize()` reports a bad callback here rather than throwing; the
        // login page reads the same values out of the URL for the visible copy.
        if (error) oauthLog('session restore rejected the callback', { code: error.code || '', message: error.message || '' })
        setSession(data?.session ?? null)
        setUser(data?.session?.user ?? null)
      })
      .catch((e) => {
        if (alive) oauthLog('session restore threw', e?.message || '')
      })
      .finally(() => { if (alive) setReady(true) })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (alive) {
        setSession(s ?? null)
        setUser(s?.user ?? null)
      }
      // Callback events only — INITIAL_SESSION is noisy and carries no news.
      if (event === 'SIGNED_IN') oauthLog('session detected', { userId: s?.user?.id || '' })
      else if (event === 'SIGNED_OUT') oauthLog('session cleared')
      else if (event === 'TOKEN_REFRESHED') oauthLog('token refreshed')
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  // Describe the callback the browser came back with, and recover it if the
  // project answers with a PKCE `?code=` instead of the implicit tokens this
  // client's default `flowType` asks for. Runs once, after `_initialize()` has
  // already had first refusal on the same URL — but reads the snapshot taken
  // at mount, because the login page has by now tidied the address.
  useEffect(() => {
    if (!ready || oauthCallbackHandled.current) return
    oauthCallbackHandled.current = true

    const cb = oauthCallback.current
    if (!cb) return

    oauthLog('callback detected', { params: cb.names, where: cb.where })

    if (cb.error || cb.errorCode || cb.errorDescription) {
      // GoTrue's own diagnostics — not credentials.
      oauthLog('actual Supabase error', {
        error: cb.error, error_code: cb.errorCode, error_description: cb.errorDescription,
      })
      return
    }

    if (!cb.code) return

    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) { oauthLog('session detected', 'code already exchanged'); return }
      oauthLog('pkce code present', 'exchanging for a session…')
      return supabase.auth.exchangeCodeForSession(cb.code)
        .then(({ error: exErr }) => {
          if (exErr) oauthLog('code exchange failed', { code: exErr.code || '', message: exErr.message || '' })
          else oauthLog('session detected', 'exchanged from code')
        })
        .catch((e) => oauthLog('code exchange threw', e?.message || ''))
    }).catch((e) => oauthLog('code exchange pre-check threw', e?.message || ''))
  }, [ready])

  const signIn = useCallback(async (email, password) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) return { error: friendlyAuthError(error) }
      setSession(data.session); setUser(data.session?.user ?? null)
      return { ok: true }
    } catch (e) {
      return { error: friendlyAuthError(e) }
    } finally { setBusy(false) }
  }, [])

  // Customer self-registration. This grants nothing but a session: admin rights
  // still require an `admins` allowlist row, which is provisioned by the owner.
  const signUp = useCallback(async (email, password) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) return { error: friendlyAuthError(error) }
      // GoTrue answers with a user that has no identities when the address is
      // already registered but unconfirmed — surface that instead of a fake success.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { error: 'An account already exists for this email. Try signing in instead.' }
      }
      if (!data.session) return { ok: true, needsConfirmation: true }
      setSession(data.session); setUser(data.session?.user ?? null)
      return { ok: true }
    } catch (e) {
      return { error: friendlyAuthError(e) }
    } finally { setBusy(false) }
  }, [])

  /**
   * Google. Supabase runs the whole redirect; the browser leaves this
   * page and returns to {@link authRedirectUrl} carrying either a session or an
   * `error` in the URL, which the login page reads back.
   *
   * Deliberately does not set the global `busy`: the page navigates away, and
   * leaving a flag stuck on would be worse than showing no spinner at all.
   */
  const signInWithOAuth = useCallback(async (provider) => {
    try {
      const redirectTo = authRedirectUrl()
      // TEMP — shows the port actually being handed to Supabase, which is the
      // value that must appear in the dashboard's Redirect URL allow-list.
      oauthLog('oauth start', { provider, redirectTo, flowType: 'implicit' })
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      })
      if (error) {
        oauthLog('oauth did not start', { provider, code: error.code || '', message: error.message || '' })
        return { error: friendlyAuthError(error, provider) }
      }
      return { ok: true }
    } catch (e) {
      oauthLog('oauth start threw', { provider, message: e?.message || '' })
      return { error: friendlyAuthError(e, provider) }
    }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true)
    try { await supabase.auth.signOut() } finally { setBusy(false) }
  }, [])

  return (
    <Ctx.Provider
      value={{
        ready, session, user, isAdmin, busy,
        signIn, signUp, signInWithOAuth, signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
