import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import AnnouncementBar from './AnnouncementBar'
import Header from './Header'
import Footer from './Footer'
import CartDrawer from './CartDrawer'
import PaymentRecovery from './PaymentRecovery'
export default function Layout() {
  const { pathname } = useLocation()
  // Block body: an effect must return undefined or a cleanup *function*.
  // `window.scrollTo()` can return a non-function value, which React would later
  // try to invoke as a cleanup and crash on every route change.
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  // Checkout is a focused page (12 Nov 2026): no announcement strip, menus or
  // footer, so nothing leads away from paying. It draws its own slim header
  // (CheckoutHeader.jsx) with the way back to the cart and WhatsApp.
  const focused = pathname.replace(/\/+$/, '') === '/checkout'
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:top-3 focus:left-3 focus:bg-white focus:border focus:border-black focus:px-4 focus:py-2 focus:rounded-md focus:text-[15px] focus:font-ui"
      >
        Skip to content
      </a>
      {!focused && <AnnouncementBar />}
      {!focused && <Header />}
      <main id="main-content"><Outlet /></main>
      {!focused && <Footer />}
      <CartDrawer />
      <PaymentRecovery />
    </>
  )
}
