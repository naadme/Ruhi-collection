// The checkout page's code is its own file, fetched on demand, so the product
// pages that ads land on download less. Everything that leads to checkout
// fetches it ahead, so it still opens at once (src/lib/pageChunk.js):
// - a basket with something in it (CartContext), once the page is idle;
// - a chosen size, or a press on "Buy it now" (Product.jsx), right away.
import { pageChunk, whenIdle } from './pageChunk'

export const checkoutPage = pageChunk(() => import('../pages/Checkout'))

/** Start fetching the checkout's code now. Safe to call any number of times. */
export const prefetchCheckout = () => checkoutPage.prefetch()

/** The same, once the page has loaded and the browser is idle. Returns a cancel function. */
export const prefetchCheckoutWhenIdle = () => whenIdle(prefetchCheckout)
