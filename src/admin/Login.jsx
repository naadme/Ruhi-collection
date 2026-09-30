import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'

// Deliberately login-only: there is no sign-up form here, and even if someone
// registers through Supabase Auth they still need an `admins` allowlist row.
export default function Login() {
  const { signIn, busy } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPw, setShowPw] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const res = await signIn(email, password)
    if (res?.error) setError(res.error)
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16 font-ui">
      <Logo />
      <div className="w-full max-w-[420px] mt-14 border border-black/10 rounded-2xl p-8 shadow-[0_2px_24px_rgba(74,44,35,.06)]">
        <h1 className="text-[28px] font-bold tracking-tight">Admin sign in</h1>
        <p className="text-black/60 mt-1 text-[15px]">Authorised staff only. Customers don’t need this.</p>

        <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
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
            <p role="alert" className="text-[14px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={busy}
            className="w-full h-[52px] rounded-lg bg-brand-green text-white font-semibold text-[16px] tracking-wide hover:bg-[#A86B5C] transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={18} /></>}
          </button>
        </form>
      </div>

      <Link to="/" className="mt-8 inline-flex items-center gap-2 text-[15px] text-black/60 hover:text-black">
        <ArrowLeft size={16} /> Back to the store
      </Link>
    </main>
  )
}
