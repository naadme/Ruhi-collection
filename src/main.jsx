import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ProductsProvider } from './context/ProductsContext'
import { CategoriesProvider } from './context/CategoriesContext'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import { WishlistProvider } from './context/WishlistContext'
import { RatingsProvider } from './context/RatingsContext'
import ErrorBoundary from './components/ErrorBoundary'
import PageTracker from './components/PageTracker'
import { captureLanding } from './lib/adClicks'
import { startExperiments } from './lib/experiments'
import './index.css'
// Read the ad click IDs and campaign tags off the address the visitor landed
// on, before the router can redirect it away (tracking brief, Section 4).
captureLanding()
// This visitor's version of each A/B test, worked out locally before anything
// is drawn, so a page never switches version on screen.
startExperiments()
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Categories wrap products: the catalogue filter and every category
          label on the storefront read the list the client manages. */}
      <CategoriesProvider>
        <ProductsProvider>
          {/* Published star ratings for cards, the buy bar and the cart. */}
          <RatingsProvider>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                {/* The GTM page entry for every route, admin included. Kept
                    outside App's Suspense so a lazily loaded page never
                    holds it back. */}
                <ErrorBoundary><PageTracker /><App /></ErrorBoundary>
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
          </RatingsProvider>
        </ProductsProvider>
      </CategoriesProvider>
    </BrowserRouter>
  </React.StrictMode>
)
