import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import AnnouncementBar from './AnnouncementBar'
import Header from './Header'
import Footer from './Footer'
import CartDrawer from './CartDrawer'
export default function Layout() {
  const { pathname } = useLocation()
  // Block body: an effect must return undefined or a cleanup *function*.
  // `window.scrollTo()` can return a non-function value, which React would later
  // try to invoke as a cleanup and crash on every route change.
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (<><AnnouncementBar /><Header /><main><Outlet /></main><Footer /><CartDrawer /></>)
}
