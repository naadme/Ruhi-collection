import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

const OAUTH_NAME = { google: 'Google' }

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
 * The `error*` fields describe a failed round-trip; `code` is the PKCE code
 * used to recover a session when the project answers with one.
 */
export function readOAuthCallback() {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search.replace(/^\?/, ''))
  if (![...query.keys(), ...hash.keys()].length) return null
  const grab = (k) => query.get(k) || hash.get(k) || ''
  return {
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
 * Where the admin login page sends the browser back to after Google.
 *
 * Same rules as {@link authRedirectUrl}: the exact URL must be listed in
 * Supabase → Authentication → URL Configuration → Redirect URLs (this project
 * already accepts it — verified against /auth/v1/authorize).
 */
export function adminAuthRedirectUrl() {
  return `${window.location.origin}/admin`
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
// Signing in is *not* enough to manage the catalogue: the full-admin and
// product-manager allowlists are separate from Supabase Auth.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canManageProducts, setCanManageProducts] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  // A reason the last OAuth round-trip could not be completed, for the login
  // page to show. Empty when there is nothing to report.
  const [oauthError, setOauthError] = useState('')

  // Re-check the allowlist whenever the signed-in identity changes.
  //
  // Keyed on the *id*, not the user object: getSession() and onAuthStateChange
  // both hand back a fresh object for the same account (initial session, token
  // refresh), and re-running the identical lookup on each of those was a
  // duplicate request on every page load for a signed-in admin.
  //
  // There is deliberately no `profiles` row to create on sign-in (nothing in
  // this app depends on one), so this lookup is the only "did the account land
  // in the database" check that runs after an OAuth round-trip.
  useEffect(() => {
    if (!user) { setIsAdmin(false); setCanManageProducts(false); return }
    let alive = true
    // Rights are cleared first: while the allowlist lookup is in flight the
    // previous account's rights must not still be on screen.
    setIsAdmin(false)
    setCanManageProducts(false)
    Promise.all([
      supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabase.from('product_managers').select('user_id').eq('user_id', user.id).maybeSingle(),
    ])
      .then(([admin, productManager]) => {
        if (!alive) return
        const adminRow = !admin.error && !!admin.data
        const productManagerRow = !productManager.error && !!productManager.data
        setIsAdmin(adminRow)
        setCanManageProducts(adminRow || productManagerRow)
      })
      .catch(() => {
        // A failed lookup must not leave the previous account's rights in
        // place: without a row we cannot say the account is an admin.
        if (!alive) return
        setIsAdmin(false)
        setCanManageProducts(false)
      })
    return () => { alive = false }
  }, [user?.id])

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
      .then(({ data }) => {
        if (!alive) return
        // A bad callback is reported by `_initialize()` rather than thrown; the
        // login page reads the same values out of the URL for the visible copy.
        setSession(data?.session ?? null)
        setUser(data?.session?.user ?? null)
      })
      .catch(() => {
        // The session could not be read: treat the visitor as signed out rather
        // than leaving the previous account's session on screen.
        if (!alive) return
        setSession(null)
        setUser(null)
      })
      .finally(() => { if (alive) setReady(true) })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (alive) {
        setSession(s ?? null)
        setUser(s?.user ?? null)
      }
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

    if (cb.error || cb.errorCode || cb.errorDescription) {
      // GoTrue's own diagnostics — not credentials. The login page reads the
      // same values out of the URL and shows the shopper a plain sentence.
      return
    }

    if (!cb.code) return

    let alive = true
    supabase.auth.getSession()
      .then(({ data }) => {
        if (data?.session) return undefined
        return supabase.auth.exchangeCodeForSession(cb.code)
      })
      .then((result) => {
        // A failed exchange resolves with an error rather than throwing; the
        // shopper would otherwise be left staring at a page that silently did
        // nothing, so the reason is put in front of them.
        const failure = result?.error
        if (!alive || !failure) return
        setOauthError(friendlyAuthError(failure))
      })
      .catch((e) => {
        if (!alive) return
        setOauthError(friendlyAuthError(e))
      })
    return () => { alive = false }
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
   *
   * `redirectTo` defaults to the storefront's {@link authRedirectUrl}; the
   * admin login overrides it with {@link adminAuthRedirectUrl} so staff come
   * back to the panel they started from instead of the shopper account page.
   */
  const signInWithOAuth = useCallback(async (provider, { redirectTo } = {}) => {
    try {
      const finalRedirectTo = redirectTo || authRedirectUrl()
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: finalRedirectTo },
      })
      if (error) {
        return { error: friendlyAuthError(error, provider) }
      }
      return { ok: true }
    } catch (e) {
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
        ready, session, user, isAdmin, canManageProducts, busy, oauthError,
        signIn, signUp, signInWithOAuth, signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
