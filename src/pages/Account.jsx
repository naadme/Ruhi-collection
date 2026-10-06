import usePageTitle from '../hooks/usePageTitle'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Loader2, LogOut, Package, ShoppingBag, Heart, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { inr } from '../lib/pricing'
import { site } from '../data/site'

const STATUS = {
  pending: ['Placed', 'bg-amber-50 text-amber-800 border-amber-200'],
  confirmed: ['Confirmed', 'bg-blue-50 text-blue-800 border-blue-200'],
  shipped: ['Shipped', 'bg-indigo-50 text-indigo-800 border-indigo-200'],
  delivered: ['Delivered', 'bg-green-50 text-green-800 border-green-200'],
  cancelled: ['Cancelled', 'bg-red-50 text-red-700 border-red-200'],
}

function OrderHistory() {
  const [state, setState] = useState({ loading: true, orders: [], error: '' })

  useEffect(() => {
    let alive = true
    supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return
        setState({ loading: false, orders: error ? [] : data || [], error: error ? error.message : '' })
      })
    return () => { alive = false }
  }, [])

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-black/55 text-[15px] py-6">
        <Loader2 size={16} className="animate-spin" /> Loading your orders…
      </p>
    )
  }
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-red-700 text-[15px] py-6">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" /> We couldn't load your orders right now. Please refresh.
      </p>
    )
  }
  if (!state.orders.length) {
    return (
      <div className="border border-dashed border-black/15 rounded-xl py-12 text-center">
        <Package size={30} className="mx-auto text-black/25" strokeWidth={1.4} />
        <p className="mt-3 text-[17px]">No orders yet</p>
        <Link to="/shop" className="btn-outline mt-5">Start shopping</Link>
      </div>
    )
  }

  return (
    <ul className="space-y-4">
      {state.orders.map((o) => {
        const [label, cls] = STATUS[o.status] || STATUS.pending
        return (
          <li key={o.id} className="border border-black/10 rounded-xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-ui font-semibold text-[16px]">{o.reference}</p>
                <p className="text-[13px] text-black/55 mt-0.5">
                  {new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[12px] font-semibold border rounded-full px-2.5 py-1 ${cls}`}>{label}</span>
                <span className="font-ui font-bold">{inr(o.total)}</span>
              </div>
            </div>
            <ul className="mt-3 pt-3 border-t border-black/10 space-y-1.5">
              {(o.order_items || []).map((it) => (
                <li key={it.id} className="flex justify-between gap-4 text-[15px] text-black/70">
                  <Link to={`/product/${it.product_id}`} className="hover:underline truncate">{it.title}</Link>
                  <span className="font-ui shrink-0">Size {it.size} · ×{it.qty} · {inr(it.unit_price * it.qty)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-black/55">
              {o.payment_method === 'razorpay' ? 'Online payment' : 'Cash on delivery'}
              {' · '}
              {o.payment_method === 'razorpay'
                ? ({ paid: 'Paid', failed: 'Payment failed', refunded: 'Refunded' }[o.payment_status] || 'Payment pending')
                : 'Pay on delivery'}
              {' · Delivered to '}{o.city}, {o.state} {o.pincode}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

function SignedIn({ email, onSignOut, busy }) {
  return (
    <div className="w-full max-w-[720px] px-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[32px]">My account</h1>
          <p className="text-black/60 mt-1">{email}</p>
        </div>
        <button
          onClick={onSignOut} disabled={busy}
          className="inline-flex items-center gap-2 text-[15px] border border-black/70 px-4 h-[42px] rounded-lg hover:bg-black hover:text-white transition disabled:opacity-60"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>

      <nav className="flex flex-wrap gap-3 mt-6">
        <Link to="/shop" className="inline-flex items-center gap-2 text-[15px] border border-black/25 px-4 h-[42px] rounded-lg hover:border-black transition">
          <ShoppingBag size={16} /> Continue shopping
        </Link>
        <Link to="/cart" className="inline-flex items-center gap-2 text-[15px] border border-black/25 px-4 h-[42px] rounded-lg hover:border-black transition">
          <ShoppingBag size={16} /> View cart
        </Link>
        <Link to="/collections" className="inline-flex items-center gap-2 text-[15px] border border-black/25 px-4 h-[42px] rounded-lg hover:border-black transition">
          <Heart size={16} /> Collections
        </Link>
      </nav>

      <h2 className="text-[22px] mt-10 mb-4">Your orders</h2>
      <OrderHistory />
    </div>
  )
}

/* -------------------------------------------------------------------------
   OAuth provider marks
   ---------------------------------------------------------------------- */

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

/**
 * Reads an OAuth failure out of the URL.
 *
 * Supabase sends a shopper who cancelled (or whose provider errored) back to
 * the redirect URL carrying `error`, `error_code` **and** `error_description`,
 * in either the query string or the hash.
 *
 * Pure — it only reads. The previous version returned the *first* non-empty of
 * the three (in practice always `error_description`) and matched against that
 * alone, so the machine codes the rules below key on — `access_denied`,
 * `server_error`, … — were never examined and nearly every failure fell
 * through to the generic sentence. All three are now matched together.
 *
 * It also used to rewrite `window.location` here. That ran from a child effect
 * *before* supabase-js's `_initialize()` parsed the same URL, so the callback
 * was destroyed while it was still being diagnosed. The rewrite now happens in
 * the effect below, gated on `ready`.
 *
 * TEMP: the raw GoTrue values are logged so the real cause is visible.
 */
function readOAuthError() {
  if (typeof window === 'undefined') return null

  const read = (raw) => {
    if (!raw) return []
    const p = new URLSearchParams(raw.replace(/^[#?]/, ''))
    return ['error', 'error_code', 'error_description']
      .map((k) => p.get(k))
      .filter(Boolean)
  }

  // Both halves matter: implicit-flow errors arrive in the hash, authorize-end
  // failures arrive in the query string.
  const found = [...read(window.location.hash), ...read(window.location.search)]
  if (!found.length) return null

  // GoTrue writes the description into both halves and the hash copy arrives
  // double-encoded (`code%3A 4%2F0A`), so decode twice before reading it —
  // otherwise the machine codes the rules below key on never match.
  const shown = found.map((v) => {
    let out = v
    for (let i = 0; i < 2; i += 1) {
      try { out = decodeURIComponent(out) } catch { break }
    }
    return out
  })

  // TEMP diagnostic — GoTrue's own error text, never a token or a secret.
  console.info('[oauth] error in URL:', shown.join(' | '))

  const lower = shown.join(' ').toLowerCase()
  if (/access_denied|403|cancelled|canceled|denied/.test(lower)) {
    return 'Sign-in was cancelled or declined. You can try again whenever you like.'
  }
  if (/provider is not enabled|provider_not_enabled|not supported/.test(lower)) {
    return 'This sign-in method has not been enabled yet.'
  }
  if (/already_exists|already registered|email_exists|identity_already_exists/.test(lower)) {
    return 'An account already exists for that email. Switch to Login instead.'
  }
  if (/rate limit|too many|over_request/.test(lower)) {
    return 'Too many attempts. Please wait a moment, then try again.'
  }
  if (/flow_state|code_verifier|expired|invalid grant/.test(lower)) {
    return 'That sign-in expired. Please start again.'
  }
  // Proven failure mode: Supabase resolved the flow state and reached Google's
  // token endpoint, which then refused the exchange. Google already validated
  // the client_id and redirect_uri at authorize time (otherwise the consent
  // screen could never have appeared), so the Client Secret stored for the
  // Google provider is the credential that does not match.
  if (/unable to exchange external code|exchange external code/i.test(lower)) {
    return 'Google sign-in could not be verified. Please try another method — the site owner needs to re-check the Google Client Secret in Supabase.'
  }
  if (/server_error|500|unexpected|database error|internal server/.test(lower)) {
    // `Unable to exchange external code: 4/0A…` is GoTrue failing to trade the
    // code Google just issued for tokens. The Client ID, the registered
    // callback URI and the redirect allow-list are all verified working, so
    // the only remaining link is the Client Secret saved in Authentication →
    // Sign In → Google. Shoppers get the normal sentence; the developer gets
    // the actual cause. Verify with `node scripts/check-google-oauth.mjs`.
    if (/unable to exchange external code/i.test(lower)) {
      return import.meta.env.DEV
        ? 'Google sign-in is failing on the server: Supabase rejected the Client Secret for the Google provider. Re-save it in Authentication → Sign In → Google.'
        : 'The sign-in could not be completed. Please try again.'
    }
    return 'The sign-in could not be completed. Please try again.'
  }
  return 'Sign-in did not complete. Please try again.'
}

/**
 * Where the shopper was heading before they were asked to sign in.
 *
 * The email flow carries this in `?next=`, but an OAuth round-trip has
 * to return to a URL that is on Supabase's allow-list — appending a query
 * string there risks a redirect the dashboard has not approved, which would
 * break Google outright. So the destination is parked in sessionStorage
 * instead: same-origin only, dropped on read, and ignored after ten minutes.
 */
const NEXT_KEY = 'ruhi:auth:next'
const NEXT_TTL = 10 * 60 * 1000

/** Mirrors the `?next=` rules: same-origin path, never the admin area. */
function safePath(next) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/admin')
    ? next
    : null
}

function stashNext(next) {
  try {
    const path = safePath(next)
    if (path) sessionStorage.setItem(NEXT_KEY, JSON.stringify({ path, at: Date.now() }))
    else sessionStorage.removeItem(NEXT_KEY)
  } catch {
    /* private browsing — the shopper simply lands on /account instead */
  }
}

function takeNext() {
  try {
    const raw = sessionStorage.getItem(NEXT_KEY)
    if (!raw) return null
    sessionStorage.removeItem(NEXT_KEY) // one-shot: never redirects twice
    const { path, at } = JSON.parse(raw)
    return Date.now() - at <= NEXT_TTL ? safePath(path) : null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------
   Login / register
   ---------------------------------------------------------------------- */

function AuthForm({ mode, setMode, onDone, busy, next }) {
  const { ready, signIn, signUp, signInWithOAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState('')   // 'google' | 'email'

  const isSignUp = mode === 'signup'

  // A failed/cancelled OAuth round-trip lands back on this page with the
  // reason in the URL — show it rather than silently doing nothing. Read once,
  // during the very first render, while the callback is still untouched.
  const [oauthError] = useState(readOAuthError)
  useEffect(() => {
    if (oauthError) setError(oauthError)
  }, [oauthError])

  // Tidy the URL only *after* Supabase has parsed it: `ready` flips once
  // `getSession()` — and therefore auth-js's `_initialize()` — has resolved.
  // Doing this synchronously in the effect above used to run before
  // `_initialize()` (child effects fire ahead of AuthProvider's) and destroy
  // the callback while it was still being diagnosed.
  useEffect(() => {
    if (!ready || !oauthError) return
    if (window.location.hash || window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [ready, oauthError])

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setNotice('')
  }

  const oauth = async (provider) => {
    setError('')
    setNotice('')
    setPending(provider)
    // Park the destination before the browser leaves for Google.
    stashNext(next)
    const res = await signInWithOAuth(provider)
    // Only reached when the redirect never started — on success the page
    // navigates away and this state is discarded.
    if (res?.error) {
      setPending('')
      setError(res.error)
      stashNext('') // nothing to come back to
    }
  }

  const submitEmail = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setPending('email')
    try {
      const res = isSignUp ? await signUp(email, password) : await signIn(email, password)
      if (res?.error) { setError(res.error); return }
      if (res?.needsConfirmation) {
        setSent(true)
        setNotice('Almost there — check your inbox for a confirmation link, then come back and sign in.')
        return
      }
      onDone()
    } finally {
      setPending('')
    }
  }

  if (sent) {
    return (
      <div className="w-full">
        <span className="inline-grid place-items-center w-12 h-12 rounded-full bg-green-50 border border-green-200 text-green-700">
          <ArrowRight size={20} />
        </span>
        <h1 className="text-[28px] font-bold mt-4">Confirm your email</h1>
        <p className="text-black/65 mt-3 leading-7">{notice}</p>
        <p className="text-black/55 mt-4 text-[15px]">
          Didn't get it? Check your spam folder, then{' '}
          <button type="button" className="underline" onClick={() => setSent(false)}>try again</button>.
        </p>
      </div>
    )
  }

  const oauthDisabled = !!pending

  return (
    <div className="w-full">
      <h1 className="text-[28px] font-bold tracking-tight">
        {isSignUp ? 'Create your account' : `Login to ${site.name}`}
      </h1>
      <p className="text-black/60 mt-2 text-[15px]">
        {isSignUp
          ? 'Save your details and keep track of every order.'
          : 'Welcome back — sign in to see your orders and check out faster.'}
      </p>

      {/* Login / Register — a mode switch rather than two content tabs, so these
          are toggle buttons (aria-pressed), not role="tab". aria-pressed is not
          valid on a tab, and a tab would promise a tabpanel that isn't here. */}
      <div className="flex gap-1 bg-black/5 rounded-lg p-1 mt-6" role="group" aria-label="Account">
        {[['signin', 'Login'], ['signup', 'Register']].map(([k, label]) => (
          <button
            key={k} type="button"
            aria-pressed={mode === k}
            onClick={() => switchMode(k)}
            className={`flex-1 h-10 rounded-lg text-[15px] font-medium transition ${mode === k ? 'bg-white shadow-sm' : 'text-black/60 hover:text-black'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 text-[14px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Google */}
      <button
        type="button" onClick={() => oauth('google')} disabled={oauthDisabled}
        className="mt-5 w-full h-[52px] rounded-lg border border-black/20 bg-white text-[16px] font-medium inline-flex items-center justify-center gap-3 hover:bg-black/[.03] hover:border-black/40 transition disabled:opacity-60"
      >
        {pending === 'google'
          ? <><Loader2 size={17} className="animate-spin" /> Opening Google…</>
          : <><GoogleMark /> Continue with Google</>}
      </button>

      {/* OR */}
      <div className="flex items-center gap-4 my-6" aria-hidden="true">
        <span className="h-px flex-1 bg-black/10" />
        <span className="text-[13px] font-semibold tracking-[.18em] text-black/40">OR</span>
        <span className="h-px flex-1 bg-black/10" />
      </div>

      {notice && !error && (
        <p className="mt-4 text-[14px] text-black/60 bg-black/[.03] border border-black/10 rounded-lg px-3 py-2.5">{notice}</p>
      )}

      <form onSubmit={submitEmail} className="mt-5 space-y-4" noValidate>
        <div>
          <label className="clabel" htmlFor="acc-email">Email address</label>
          <input
            id="acc-email" type="email" required autoComplete="email" className="cfield"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="clabel" htmlFor="acc-password">Password</label>
          <input
            id="acc-password" type="password" required autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={8} className="cfield" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
          />
        </div>
        <button
          type="submit" disabled={oauthDisabled || busy}
          className="w-full h-[52px] rounded-lg bg-brand-green text-white text-[16px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#A86B5C] transition disabled:opacity-60"
        >
          {(pending === 'email' || busy) && <Loader2 size={17} className="animate-spin" />}
          {(pending === 'email' || busy) ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="text-[15px] text-black/65 mt-6 text-center">
        {isSignUp ? 'Already have an account? ' : `New to ${site.name}? `}
        <button
          type="button"
          onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}
          className="font-semibold text-brand-green underline underline-offset-2 hover:text-[#A86B5C]"
        >
          {isSignUp ? 'Login' : 'Create an account'}
        </button>
      </p>

      <p className="text-[13px] text-black/50 mt-5 leading-6">
        An account only lets you track your own orders. It never grants access to the store's admin area.
      </p>
    </div>
  )
}

export default function Account() {
  const { ready, user, signOut, busy } = useAuth()
  const [mode, setMode] = useState('signin')
  const [key, setKey] = useState(0)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [stashed, setStashed] = useState(null)
  usePageTitle(user ? 'My account' : 'Sign in')

  // Pick up a destination an OAuth round-trip parked before leaving this page.
  useEffect(() => { setStashed(takeNext()) }, [])

  // Only same-origin paths — never an open redirect off this domain.
  const safeNext = safePath(params.get('next')) || stashed

  useEffect(() => {
    if (ready && user && safeNext) navigate(safeNext, { replace: true })
  }, [ready, user, safeNext, navigate])

  if (!ready) {
    return (
      <section className="min-h-[60vh] grid place-items-center">
        <p className="flex items-center gap-2 text-black/55"><Loader2 size={18} className="animate-spin" /> Checking your session…</p>
      </section>
    )
  }

  // Already signed in and heading back to where the shopper came from
  // (checkout, for instance) — never flash the login form first.
  if (user && safeNext) {
    return (
      <section className="min-h-[60vh] grid place-items-center">
        <p className="flex items-center gap-2 text-black/55"><Loader2 size={18} className="animate-spin" /> Taking you back…</p>
      </section>
    )
  }

  if (user) return (
    <section className="min-h-[60vh] py-14 flex justify-center">
      <SignedIn email={user.email} onSignOut={signOut} busy={busy} />
    </section>
  )

  return (
    <section className="min-h-[60vh] flex flex-col items-center pt-12 pb-16 font-ui">
      <Link to="/" aria-label={`${site.name} — home`} className="block">
        <img
          src="/images/ruhi-logo.jpg"
          alt={site.name}
          width={968}
          height={628}
          className="block h-16 md:h-20 w-auto object-contain"
        />
      </Link>

      <div className="w-full max-w-[420px] mt-8 px-4 border border-black/10 rounded-2xl p-6 sm:p-8 bg-white shadow-[0_2px_24px_rgba(74,44,35,.06)]">
        <AuthForm
          key={key} mode={mode} setMode={setMode} busy={busy} next={safeNext}
          onDone={() => setKey((k) => k + 1)}
        />
      </div>

      <p className="text-[14px] text-black/55 mt-8">
        Prefer to browse? <Link to="/shop" className="underline underline-offset-2">Go to the shop</Link>
      </p>
      <Link to="/policies/privacy-policy" className="text-[14px] text-black/50 underline underline-offset-2 mt-4">Privacy policy</Link>
    </section>
  )
}
