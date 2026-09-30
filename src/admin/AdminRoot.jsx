import { Link } from 'react-router-dom'
import { Loader2, ShieldAlert, ArrowLeft } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import { useAuth } from '../context/AuthContext'
import Login from './Login'
import Dashboard from './Dashboard'

function Splash({ text }) {
  return (
    <main className="min-h-screen grid place-items-center font-ui text-black/60">
      <span className="flex items-center gap-3"><Loader2 size={20} className="animate-spin" />{text}</span>
    </main>
  )
}

function Wordmark() {
  return (
    <Link to="/" className="shrink-0 block" aria-label="Ruhi Womens Clothing — home">
      <img
        src="/images/ruhi-logo.jpg"
        alt="Ruhi Womens Clothing"
        width={968}
        height={628}
        className="block h-10 md:h-12 w-auto object-contain"
      />
    </Link>
  )
}

// Signed in, but no `admins` row. Explains exactly what the owner must do.
function NotAuthorized({ email }) {
  const { signOut, busy } = useAuth()
  return (
    <div className="max-w-[560px] mx-auto text-center py-16">
      <span className="inline-grid place-items-center w-14 h-14 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
        <ShieldAlert size={26} strokeWidth={1.6} />
      </span>
      <h1 className="text-[30px] font-bold mt-5">This account isn’t authorised</h1>
      <p className="text-black/60 mt-3 text-[15px] leading-relaxed">
        You’re signed in as <strong className="text-black/80">{email}</strong>, but it doesn’t have admin
        access yet. Signing in alone never grants admin rights — the account must be added to the allowlist.
      </p>
      <div className="mt-6 text-left bg-white border border-black/10 rounded-xl p-5">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-black/45">For the store owner</p>
        <p className="text-[14px] text-black/65 mt-2">In Supabase → SQL Editor, run:</p>
        <code className="block mt-2 bg-[#4A2C23] text-[#F8EDE6] rounded-lg px-4 py-3 text-[13px] overflow-x-auto">
          select public.make_admin('{email || ''}');
        </code>
      </div>
      <div className="flex flex-wrap gap-3 justify-center mt-7">
        <button onClick={signOut} disabled={busy} className="btn-outline">Sign out</button>
        <Link to="/" className="btn-outline inline-flex items-center gap-2"><ArrowLeft size={15} /> Back to the store</Link>
      </div>
    </div>
  )
}

// Route gate for /admin. Never inside the storefront <Layout>, so the public
// header, footer and navigation are not part of the admin surface.
export default function AdminRoot() {
  usePageTitle('Admin')
  const { ready, session, isAdmin, user, signOut, busy } = useAuth()

  if (!ready) return <Splash text="Checking access…" />
  if (!session) return <Login />

  return (
    <div className="min-h-screen bg-[#F8EDE6] font-ui flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-black/10">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 h-[68px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Wordmark />
            <span className="hidden sm:inline text-[12px] font-medium text-black/50 border border-black/15 rounded-full px-2.5 py-1 bg-white">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            {isAdmin && <span className="hidden md:block text-[14px] text-black/55 truncate max-w-[240px]">{user?.email}</span>}
            <button onClick={signOut} disabled={busy} className="text-[14px] border border-black/70 px-4 py-2 rounded-lg hover:bg-black hover:text-white transition disabled:opacity-60">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-8">
          {!isAdmin ? <NotAuthorized email={user?.email || ''} /> : <Dashboard />}
        </div>
      </main>
    </div>
  )
}
