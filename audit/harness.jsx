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
import { StrictMode, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { ProductsProvider, useProducts } from '../src/context/ProductsContext'
import { CategoriesProvider } from '../src/context/CategoriesContext'
import { WishlistProvider } from '../src/context/WishlistContext'
import { CartProvider } from '../src/context/CartContext'
import BannerPanel from '../src/admin/BannerPanel'
import CategoriesPanel from '../src/admin/CategoriesPanel'
import CategoryImagesPanel from '../src/admin/CategoryImagesPanel'
import BestsellerPanel from '../src/admin/BestsellerPanel'
import { BestSellers } from '../src/components/Sections'
import OrdersPanel from '../src/admin/OrdersPanel'
import ReviewsPanel from '../src/admin/ReviewsPanel'
import ProductEditor from '../src/admin/ProductEditor'
import { ProductRow, GroupCard } from '../src/admin/ProductList'
import { groupRows } from '../src/lib/productGrouping'
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

// The products panel: the shop's own list of products and the editor that
// opens on one of them, with the real catalogue behind them. It is here so a
// browser can read the Product ID off the list and off the editor — the two
// places an owner looks for it.
function ProductsPanel() {
  const { all } = useProducts()
  const [editing, setEditing] = useState(null)
  const groups = groupRows(all)
  return (
    <>
      <Panel name="products">
        <ul>
          {groups.slice(0, 6).map((g) => (
            g.rows.length === 1 ? (
              <ProductRow
                key={g.rows[0].id}
                p={g.rows[0]}
                busy={false}
                onToggle={() => {}}
                onEdit={() => setEditing({ rows: g.rows })}
                onDelete={() => {}}
              />
            ) : (
              <GroupCard
                key={g.key}
                g={g}
                expanded
                onExpand={() => {}}
                busyId={null}
                onToggleGroup={() => {}}
                onToggleVariant={() => {}}
                onEdit={() => setEditing({ rows: g.rows })}
                onEditVariant={(r) => setEditing({ rows: g.rows, focusKey: r.id })}
                onAddColour={() => setEditing({ rows: g.rows, addColour: true })}
                onDeleteGroup={() => {}}
                onRemoveVariant={() => {}}
              />
            )
          ))}
        </ul>
        <button
          id="open-the-editor"
          onClick={() => setEditing({ rows: groups[0]?.rows || [] })}
          style={{ margin: 12 }}
        >
          Edit the first product
        </button>
      </Panel>
      <ProductEditor
        open={!!editing}
        isNew={false}
        initial={editing ? { rows: editing.rows || [] } : null}
        focusKey={editing?.focusKey || ''}
        addColour={!!editing?.addColour}
        takenIds={new Set()}
        canManageCategories={false}
        onClose={() => setEditing(null)}
        onSave={() => setEditing(null)}
      />
    </>
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
      {/* The homepage's Best Sellers row, on its own. It is the surface the
          four-across / arrows-only-past-four rule renders on, so a browser can
          prove the row for 0, 1, 4 and 5 designs without the rest of the page.
          It links to products, so it needs a router of its own. */}
      <Panel name="home-bestsellers"><MemoryRouter><BestSellers /></MemoryRouter></Panel>
      <Panel name="orders"><OrdersPanel notify={notify} /></Panel>
      {/* The dashboard hands this panel the same raw catalogue rows it does
          the best sellers one — a review is shown under the product it names. */}
      <Panel name="reviews"><ReviewsPanel notify={notify} products={all} /></Panel>
      <ProductsPanel />
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
