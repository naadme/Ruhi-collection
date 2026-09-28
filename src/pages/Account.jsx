import usePageTitle from '../hooks/usePageTitle'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, LogOut, Package, ShoppingBag, Heart, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { inr } from '../lib/pricing'

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
          <li key={o.id} className="border border-black/12 rounded-xl p-4 sm:p-5">
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
              {o.payment_method === 'cod' ? 'Cash on delivery' : o.payment_method} · Delivered to {o.city}, {o.state} {o.pincode}
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

function AuthForm({ mode, setMode, onDone, busy }) {
  const { signIn, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sent, setSent] = useState(false)

  const isSignUp = mode === 'signup'

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setNotice('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    const res = isSignUp ? await signUp(email, password) : await signIn(email, password)
    if (res?.error) { setError(res.error); return }
    if (res?.needsConfirmation) {
      setSent(true)
      setNotice('Almost there — check your inbox for a confirmation link, then come back and sign in.')
      return
    }
    onDone()
  }

  if (sent) {
    return (
      <div className="w-full">
        <span className="inline-grid place-items-center w-12 h-12 rounded-full bg-green-50 border border-green-200 text-green-700">
          <ArrowRight size={20} />
        </span>
        <h1 className="text-[28px] font-bold mt-4">Confirm your email</h1>
        <p className="text-black/65 mt-3 leading-7">{notice}</p>
        <p className="text-black/55 mt-4 text-[15px]">Didn't get it? Check your spam folder, then <button type="button" className="underline" onClick={() => setSent(false)}>try again</button>.</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <h1 className="text-[28px] font-bold">{isSignUp ? 'Create an account' : 'Sign in'}</h1>
      <p className="text-black/60 mt-2">{isSignUp ? 'Save your details and keep track of every order.' : 'Welcome back — sign in to see your orders.'}</p>

      <div className="flex gap-1 bg-black/5 rounded-lg p-1 mt-6">
        {[['signin', 'Sign in'], ['signup', 'Create account']].map(([k, label]) => (
          <button
            key={k} type="button" onClick={() => { setMode(k); setError('') }}
            aria-pressed={mode === k}
            className={`flex-1 h-10 rounded-md text-[15px] font-medium transition ${mode === k ? 'bg-white shadow-sm' : 'text-black/60 hover:text-black'}`}
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

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="clabel" htmlFor="acc-email">Email</label>
          <input id="acc-email" type="email" required autoComplete="email" className="cfield"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="clabel" htmlFor="acc-password">Password</label>
          <input id="acc-password" type="password" required autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={8} className="cfield" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <button
          type="submit" disabled={busy}
          className="w-full h-[52px] rounded-lg bg-brand-green text-white text-[16px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#12572f] transition disabled:opacity-60"
        >
          {busy && <Loader2 size={17} className="animate-spin" />}
          {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="text-[13px] text-black/50 mt-4 leading-6">
        An account only lets you track your own orders. It never grants access to the store's admin area.
      </p>
    </div>
  )
}

export default function Account() {
  const { ready, user, signOut, busy } = useAuth()
  const [mode, setMode] = useState('signin')
  const [key, setKey] = useState(0)
  usePageTitle(user ? 'My account' : 'Sign in')

  if (!ready) {
    return (
      <section className="min-h-[60vh] grid place-items-center">
        <p className="flex items-center gap-2 text-black/55"><Loader2 size={18} className="animate-spin" /> Checking your session…</p>
      </section>
    )
  }

  if (user) return (
    <section className="min-h-[60vh] py-14 flex justify-center">
      <SignedIn email={user.email} onSignOut={signOut} busy={busy} />
    </section>
  )

  return (
    <section className="min-h-[60vh] flex flex-col items-center pt-14 pb-16 font-ui">
      <Link to="/" className="flex items-baseline gap-2" aria-label="Rohi Collection — home">
        <span className="font-serif font-bold text-[26px] leading-none tracking-[.14em] text-brand-green">ROHI</span>
        <span className="font-ui font-semibold text-[9px] tracking-[.4em] text-[#c9a400]">COLLECTION</span>
      </Link>
      <div className="w-full max-w-[420px] mt-10 px-4">
        <AuthForm key={key} mode={mode} setMode={setMode} busy={busy} onDone={() => setKey((k) => k + 1)} />
      </div>
      <p className="text-[14px] text-black/55 mt-10">
        Prefer to browse? <Link to="/shop" className="underline underline-offset-2">Go to the shop</Link>
      </p>
      <Link to="/policies/privacy-policy" className="text-[14px] text-black/50 underline underline-offset-2 mt-6">Privacy policy</Link>
    </section>
  )
}
