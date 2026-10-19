import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ProductsProvider } from './context/ProductsContext'
import { CategoriesProvider } from './context/CategoriesContext'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import { WishlistProvider } from './context/WishlistContext'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Categories wrap products: the catalogue filter and every category
          label on the storefront read the list the client manages. */}
      <CategoriesProvider>
        <ProductsProvider>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <ErrorBoundary><App /></ErrorBoundary>
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
        </ProductsProvider>
      </CategoriesProvider>
    </BrowserRouter>
  </React.StrictMode>
)
