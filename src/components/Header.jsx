import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Search, User, ShoppingBag, Menu, X } from 'lucide-react'
import Logo from './Logo'
import SearchBar from './SearchBar'
import { site } from '../data/site'
import { useCart } from '../context/CartContext'
export default function Header() {
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const { count, setOpen } = useCart()
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-black/10">
      <div className="max-w-page mx-auto flex items-center justify-between px-4 md:px-12 h-[84px] md:h-[104px]">
        <button className="md:hidden p-2" onClick={() => setMenu(true)} aria-label="Menu"><Menu /></button>
        <Logo />
        <nav className="hidden md:flex gap-8 ml-12 mr-auto text-[17px] tracking-wide text-black/70">
          {site.nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `hover:underline underline-offset-4 ${isActive ? 'text-black underline' : ''}`}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 md:gap-6">
          <button onClick={() => setSearch(true)} aria-label="Search" className="p-2"><Search strokeWidth={1.4} size={26} /></button>
          <Link to="/account" aria-label="Account" className="p-2 hidden sm:block"><User strokeWidth={1.4} size={26} /></Link>
          <button onClick={() => setOpen(true)} aria-label="Cart" className="p-2 relative"><ShoppingBag strokeWidth={1.4} size={26} />
            {count > 0 && <span className="absolute top-0 right-0 bg-brand-green text-white text-[11px] w-5 h-5 rounded-full grid place-items-center font-ui">{count}</span>}
          </button>
        </div>
      </div>
      {search && <SearchBar onClose={() => setSearch(false)} />}
      {menu && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setMenu(false)}>
          <aside className="bg-white w-[85%] max-w-sm h-full p-6" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenu(false)} className="mb-6" aria-label="Close"><X /></button>
            {[...site.nav, { label: 'Log in', to: '/account' }, { label: 'Cart', to: '/cart' }].map((n) => <Link key={n.to} to={n.to} onClick={() => setMenu(false)} className="block py-4 text-xl border-b border-black/10">{n.label}</Link>)}
          </aside>
        </div>
      )}
    </header>
  )
}
