// The audit harness — renders the admin panels so a real browser can prove
// they do not crash, and that the new controls work.
//
// It is NOT part of the site: the production build only bundles index.html, so
// nothing here is ever published. Run it with:
//
//   npx vite dev --port 5199
//   node scripts/audit-admin-panels.mjs http://localhost:5199/audit/index.html
//
// The scripts beside it also intercept the browser's requests, so the panels
// can be driven with made-up rows without touching the database.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductsProvider, useProducts } from '../src/context/ProductsContext'
import { CategoriesProvider } from '../src/context/CategoriesContext'
import { WishlistProvider } from '../src/context/WishlistContext'
import { CartProvider } from '../src/context/CartContext'
import BannerPanel from '../src/admin/BannerPanel'
import CategoriesPanel from '../src/admin/CategoriesPanel'
import CategoryImagesPanel from '../src/admin/CategoryImagesPanel'
import BestsellerPanel from '../src/admin/BestsellerPanel'
import OrdersPanel from '../src/admin/OrdersPanel'
import '../src/index.css'

const notify = (kind, message) => {
  window.__notifications = window.__notifications || []
  window.__notifications.push({ kind, message })
}

function Panel({ name, children }) {
  return (
    <section data-panel={name} style={{ padding: 20, borderBottom: '2px solid #000' }}>
      <h1 style={{ fontSize: 28 }}>{name}</h1>
      {children}
    </section>
  )
}

// The dashboard hands the bestseller panel the RAW catalogue rows, not the
// grouped cards — the panel does its own grouping.
function Inside() {
  const { all } = useProducts()
  return (
    <>
      <Panel name="banners"><BannerPanel notify={notify} /></Panel>
      <Panel name="category-images"><CategoryImagesPanel notify={notify} /></Panel>
      <Panel name="bestsellers"><BestsellerPanel notify={notify} products={all} /></Panel>
      <Panel name="categories"><CategoriesPanel notify={notify} /></Panel>
      <Panel name="orders"><OrdersPanel notify={notify} /></Panel>
    </>
  )
}

function Harness() {
  return (
    <StrictMode>
      <ProductsProvider>
        <CategoriesProvider>
          <WishlistProvider>
            <CartProvider>
              <Inside />
            </CartProvider>
          </WishlistProvider>
        </CategoriesProvider>
      </ProductsProvider>
    </StrictMode>
  )
}

window.__harnessReady = false
createRoot(document.getElementById('root')).render(<Harness />)
// The panels read the catalogue and the categories from Supabase; give them a
// moment, then say the harness is ready.
setTimeout(() => { window.__harnessReady = true }, 6000)
