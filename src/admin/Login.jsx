import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth, readOAuthCallback, adminAuthRedirectUrl } from '../context/AuthContext'

// Admin sign-in offers BOTH methods because the two identity types differ:
//
//   • Google accounts (the store owner's) have NO password in Supabase Auth —
//     `signInWithPassword` can only ever answer "invalid login credentials".
//     They sign in through the Google button below, which returns to /admin.
//   • Email+password accounts use the form, unchanged.
//
// Neither method grants anything on its own: the session still has to pass the
// `admins` / `product_managers` allowlist checks (RLS in the database, mirrored
// by AuthContext), so a customer who registers gets nothing but a session.

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l7.98-6.19C12.43 34.28 17.74 38.5 24 38.5z" />
  </svg>
)

/**
 * Turn a GoTrue callback failure into a sentence an admin can act on.
 *
 * `cb` comes from AuthContext's readOAuthCallback, which already un-double-
 * encodes the values. Mirrors the rules the storefront's Account page uses,
 * with admin-flavoured copy. Never echoes tokens — GoTrue puts no token in an
 * error callback, and this reads only the three error fields.
 */
function callbackErrorText(cb) {
  if (!cb) return ''
  const lower = `${cb.error || ''} ${cb.errorCode || ''} ${cb.errorDescription || ''}`.toLowerCase()
  if (/access_denied|403|cancelled|canceled|denied/.test(lower)) {
    return 'Google sign-in was cancelled or declined. You can try again whenever you like.'
  }
  if (/provider is not enabled|provider_not_enabled|not supported/.test(lower)) {
    return 'Google sign-in has not been enabled yet in the Supabase dashboard.'
  }
  if (/rate limit|too many|over_request/.test(lower)) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (/flow_state|code_verifier|expired|invalid grant/.test(lower)) {
    return 'That sign-in expired. Please start again.'
  }
  // Proven failure mode elsewhere in this project: GoTrue reached Google's
  // token endpoint and was refused — the Client Secret stored in Supabase does
  // not match the Client ID. The owner fixes it in the dashboard.
  if (/unable to exchange external code|exchange external code/.test(lower)) {
    return 'Google sign-in could not be verified. The site owner needs to re-check the Google Client Secret in Supabase.'
  }
  const description = (cb.errorDescription || '').trim()
  return description || 'Google sign-in failed. Please try again, or sign in with email instead.'
}

export default function Login() {
  const { signIn, signInWithOAuth, busy, ready } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pending, setPending] = useState('') // '' | 'google'

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setPending('')
    const res = await signIn(email, password)
    if (res?.error) setError(res.error)
  }

  // The browser may come back from Google carrying an *error* instead of a
  // session (cancelled, provider misconfigured, expired flow). Read it once at
  // mount — AdminRoot only renders this page after `ready`, so supabase-js has
  // already parsed the URL and it is safe to tidy it here.
  useEffect(() => {
    const cb = readOAuthCallback()
    if (cb?.error || cb?.errorCode || cb?.errorDescription) setError(callbackErrorText(cb))
    if (ready && (window.location.hash || window.location.search)) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const oauth = async () => {
    setError('')
    setPending('google')
    // The browser leaves for Google; this state is discarded on success.
    const res = await signInWithOAuth('google', { redirectTo: adminAuthRedirectUrl() })
    if (res?.error) {
      setPending('')
      setError(res.error)
    }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16 font-ui">
      <Logo />
      <div className="w-full max-w-[420px] mt-14 border border-black/10 rounded-2xl p-8 shadow-[0_2px_24px_rgba(74,44,35,.06)]">
        <h1 className="text-[28px] font-bold tracking-tight">Admin sign in</h1>
        <p className="text-black/60 mt-1 text-[15px]">Authorised staff only. Customers don’t need this.</p>

        <button
          type="button" onClick={oauth} disabled={busy || !!pending}
          className="mt-7 w-full h-[52px] rounded-lg border border-black/25 bg-white hover:bg-black/[.03] transition disabled:opacity-60 flex items-center justify-center gap-3 text-[16px] font-medium"
        >
          {pending === 'google'
            ? <><Loader2 size={18} className="animate-spin" /> Opening Google…</>
            : <><GoogleMark /> Continue with Google</>}
        </button>

        <div className="flex items-center gap-3 my-6" aria-hidden="true">
          <span className="flex-1 h-px bg-black/10" />
          <span className="text-[12px] uppercase tracking-wider text-black/40">or sign in with email</span>
          <span className="flex-1 h-px bg-black/10" />
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <label className="block">
            <span className="text-[13px] font-medium text-black/70">Email</span>
            <input
              type="email" required autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              className="mt-1.5 w-full border border-black/35 rounded-lg px-4 h-[52px] text-[16px] outline-none focus:border-black focus:ring-2 focus:ring-black/10"
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-medium text-black/70">Password</span>
            <span className="relative block mt-1.5">
              <input
                type={showPw ? 'text' : 'password'} required autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                className="w-full border border-black/35 rounded-lg pr-24 px-4 h-[52px] text-[16px] outline-none focus:border-black focus:ring-2 focus:ring-black/10"
              />
              <button
                type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-black/55 hover:text-black"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-[14px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={busy || !!pending}
            className="w-full h-[52px] rounded-lg bg-brand-green text-white font-semibold text-[16px] tracking-wide hover:bg-[#A86B5C] transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
          </button>
        </form>

        <p className="text-[13px] text-black/45 mt-5 leading-relaxed">
          Signed in with Google on the store? Use <strong className="text-black/60">Continue with Google</strong> —
          Google accounts have no password, so email sign-in can never work for them.
          Access is still granted by the store owner, one account at a time.
        </p>
      </div>

      <Link to="/" className="mt-8 inline-flex items-center gap-2 text-[15px] text-black/60 hover:text-black">
        <ArrowLeft size={16} /> Back to the store
      </Link>
    </main>
  )
}
