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
import Account from './pages/Account'
import Policy from './pages/Policy'
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} /><Route path="shop" element={<Shop />} /><Route path="catalog" element={<Navigate to="/shop" replace />} /><Route path="collections" element={<Collections />} /><Route path="about" element={<About />} /><Route path="product/:id" element={<Product />} />
        <Route path="contact" element={<Contact />} /><Route path="cart" element={<Cart />} /><Route path="policies/:slug" element={<Policy />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
