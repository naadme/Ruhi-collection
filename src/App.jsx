import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Shop from './pages/Shop'
import Collections from './pages/Collections'
import About from './pages/About'
import NotFound from './pages/NotFound'
import Product from './pages/Product'
import Contact from './pages/Contact'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import Wishlist from './pages/Wishlist'
import Account from './pages/Account'

// The dashboard and the legal pages are far heavier than the shop itself and
// most visitors never open them, so they load on demand instead of inflating
// the first page load.
const AdminRoot = lazy(() => import('./admin/AdminRoot'))
const Policy = lazy(() => import('./pages/Policy'))

const Loading = () => (
  <main className="min-h-[60vh] grid place-items-center text-black/50 font-ui" role="status">
    Loading…
  </main>
)

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Private dashboard — deliberately outside <Layout> so the public
            header, footer and navigation never wrap admin screens. */}
        <Route path="/admin" element={<AdminRoot />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} /><Route path="shop" element={<Shop />} /><Route path="catalog" element={<Navigate to="/shop" replace />} /><Route path="collections" element={<Collections />} /><Route path="about" element={<About />} /><Route path="product/:id" element={<Product />} />
          <Route path="contact" element={<Contact />} /><Route path="cart" element={<Cart />} /><Route path="policies/:slug" element={<Policy />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order/:reference" element={<OrderConfirmation />} />
          <Route path="wishlist" element={<Wishlist />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
