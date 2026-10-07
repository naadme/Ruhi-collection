import { useCallback, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Search, User, ShoppingBag, Menu, X, Heart, ChevronDown } from 'lucide-react'
import Logo from './Logo'
import SearchBar from './SearchBar'
import { site } from '../data/site'
import { useCart } from '../context/CartContext'
import { useWishlist } from '../context/WishlistContext'
import useOverlay from '../hooks/useOverlay'

/* `ring` strokes the badge in the header's own cream so one sitting on a
   filled icon — the saved heart, which uses the badge's exact colour — reads
   as two shapes instead of a single blob. The offset shadow sits outside the
   box, so it costs no layout and cannot clip the count. */
const Badge = ({ n, ring }) => n > 0 && (
  <span className={`absolute top-0 right-0 bg-brand-badge text-white text-[11px] min-w-[20px] h-5 px-1 rounded-full grid place-items-center font-ui${ring ? ' shadow-[0_0_0_2px_#FAF0E7]' : ''}`}>{n}</span>
)

export default function Header() {
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const [catalogue, setCatalogue] = useState(false)
  const { count, setOpen } = useCart()
  const { ids } = useWishlist()
  const panel = useRef(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  useOverlay(menu, closeMenu, panel)
  const menuLinks = [...site.nav, { label: 'Wishlist', to: '/wishlist' }, { label: 'Account', to: '/account' }, { label: 'Cart', to: '/cart' }]
  return (
    /* `#FAF0E7` is sampled straight from public/images/ruhi-logo.jpg so the
       logo's own cream plate disappears into the bar instead of reading as a
       rectangle. Every surface the header owns (dropdown, search panel, mobile
       drawer) uses the same value for a seamless match on desktop and mobile. */
    <header className="sticky top-0 z-40 bg-[#FAF0E7] border-b border-black/10">
      <div className="max-w-page mx-auto flex items-center justify-between px-4 md:px-12 h-[84px] md:h-[104px]">
        {/* The full nav only appears at `lg`; between 640px and 1024px the four
            links plus the four action icons do not fit side by side. */}
        <button className="lg:hidden p-2" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}><Menu /></button>
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex gap-8 ml-12 mr-auto text-[17px] tracking-wide text-black/70">
          {site.nav.map((n) => (n.children ? (
            // Catalogue behaves as a dropdown: it opens on hover, on click and
            // on keyboard focus, and closes on mouse leave, blur or Escape.
            <div
              key={n.to} className="relative"
              onMouseEnter={() => setCatalogue(true)}
              onMouseLeave={() => setCatalogue(false)}
              onFocus={() => setCatalogue(true)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setCatalogue(false) }}
              onKeyDown={(e) => { if (e.key === 'Escape') setCatalogue(false) }}
            >
              <NavLink
                to={n.to}
                onClick={() => setCatalogue(true)}
                aria-haspopup="true"
                aria-expanded={catalogue}
                className={({ isActive }) => `flex items-center gap-1.5 hover:underline underline-offset-4 ${isActive ? 'text-black underline' : ''}`}
              >
                {n.label}
                <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" className={`transition-transform duration-200 ${catalogue ? 'rotate-180' : ''}`} />
              </NavLink>
              {catalogue && (
                /* The padded wrapper bridges the gap between the label and the
                   panel so the pointer never leaves the branch in between. */
                <div className="absolute left-0 top-full pt-3 z-50">
                  <ul className="min-w-[230px] bg-[#FAF0E7] border border-black/10 rounded-lg shadow py-2">
                    {n.children.map((c) => (
                      <li key={c.to}>
                        <Link to={c.to} onClick={() => setCatalogue(false)} className="block px-5 py-2.5 text-[16px] tracking-wide text-black/70 hover:text-black hover:bg-black/5 transition-colors">{c.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `hover:underline underline-offset-4 ${isActive ? 'text-black underline' : ''}`}>{n.label}</NavLink>
          )))}
        </nav>
        <div className="flex items-center gap-2 md:gap-5">
          <button onClick={() => setSearch(true)} aria-label="Search" className="p-2"><Search strokeWidth={1.4} size={26} /></button>
          <Link to="/wishlist" aria-label={`Wishlist, ${ids.length} saved`} className="p-2 relative">
            <Heart strokeWidth={1.4} size={26} fill={ids.length ? '#C08576' : 'none'} stroke={ids.length ? '#C08576' : 'currentColor'} />
            <Badge n={ids.length} ring />
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
          <aside ref={panel} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} className="bg-[#FAF0E7] w-[85%] max-w-sm h-full p-6 outline-none" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeMenu} className="mb-6" aria-label="Close menu"><X /></button>
            {menuLinks.map((n) => (n.children ? (
              <div key={n.to} className="border-b border-black/10">
                <Link to={n.to} onClick={closeMenu} className="block py-4 text-xl">{n.label}</Link>
                <ul className="pb-3">
                  {n.children.map((c) => (
                    <li key={c.to}>
                      <Link to={c.to} onClick={closeMenu} className="block py-2 pl-4 text-[17px] text-black/70 hover:text-black">{c.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Link key={n.to} to={n.to} onClick={closeMenu} className="block py-4 text-xl border-b border-black/10">{n.label}</Link>
            )))}
          </aside>
        </div>
      )}
    </header>
  )
}
