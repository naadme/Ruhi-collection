import { useCallback, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Search, User, ShoppingBag, Menu, X, Heart } from 'lucide-react'
import Logo from './Logo'
import SearchBar from './SearchBar'
import { site } from '../data/site'
import { useCart } from '../context/CartContext'
import { useWishlist } from '../context/WishlistContext'
import useOverlay from '../hooks/useOverlay'

const Badge = ({ n }) => n > 0 && (
  <span className="absolute top-0 right-0 bg-brand-badge text-white text-[11px] min-w-[20px] h-5 px-1 rounded-full grid place-items-center font-ui">{n}</span>
)

export default function Header() {
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const { count, setOpen } = useCart()
  const { ids } = useWishlist()
  const panel = useRef(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  useOverlay(menu, closeMenu, panel)
  const menuLinks = [...site.nav, { label: 'Wishlist', to: '/wishlist' }, { label: 'Account', to: '/account' }, { label: 'Cart', to: '/cart' }]
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-black/10">
      <div className="max-w-page mx-auto flex items-center justify-between px-4 md:px-12 h-[84px] md:h-[104px]">
        {/* The full nav only appears at `lg`; between 640px and 1024px the five
            links plus the four action icons do not fit side by side. */}
        <button className="lg:hidden p-2" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}><Menu /></button>
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex gap-8 ml-12 mr-auto text-[17px] tracking-wide text-black/70">
          {site.nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `hover:underline underline-offset-4 ${isActive ? 'text-black underline' : ''}`}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 md:gap-5">
          <button onClick={() => setSearch(true)} aria-label="Search" className="p-2"><Search strokeWidth={1.4} size={26} /></button>
          <Link to="/wishlist" aria-label={`Wishlist, ${ids.length} saved`} className="p-2 relative">
            <Heart strokeWidth={1.4} size={26} fill={ids.length ? '#dc2626' : 'none'} stroke={ids.length ? '#dc2626' : 'currentColor'} />
            <Badge n={ids.length} />
          </Link>
          <Link to="/account" aria-label="Account" className="p-2 hidden sm:block"><User strokeWidth={1.4} size={26} /></Link>
          <button onClick={() => setOpen(true)} aria-label={`Cart, ${count} items`} className="p-2 relative"><ShoppingBag strokeWidth={1.4} size={26} />
            <Badge n={count} />
          </button>
        </div>
      </div>
      {search && <SearchBar onClose={() => setSearch(false)} />}
      {menu && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={closeMenu}>
          <aside ref={panel} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} className="bg-white w-[85%] max-w-sm h-full p-6 outline-none" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeMenu} className="mb-6" aria-label="Close menu"><X /></button>
            {menuLinks.map((n) => <Link key={n.to} to={n.to} onClick={closeMenu} className="block py-4 text-xl border-b border-black/10">{n.label}</Link>)}
          </aside>
        </div>
      )}
    </header>
  )
}
