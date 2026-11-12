import { Link } from 'react-router-dom'

// Shown on /checkout when the checkout page's code could not be fetched, even
// after one retry (src/lib/pageChunk.js): a dropped connection, or a tab
// opened before the site was updated, whose old files are gone. A reload
// fetches the current site, and the cart is kept on the device, so nothing is
// lost. Kept in the main bundle on purpose: it must work when checkout can't.
export default function CheckoutUnavailable() {
  return (
    <section role="alert" className="max-w-md mx-auto px-4 py-24 text-center">
      <h1 className="text-[32px] leading-tight">Checkout didn't load</h1>
      <p className="mt-4 text-[17px] text-black/65">Please check your connection and reload the page. Your cart is saved.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 w-full h-[54px] rounded-lg bg-brand-cta text-white text-[17px] font-semibold hover:bg-brand-cta-hover transition"
      >
        Reload the page
      </button>
      <Link to="/cart" className="mt-5 inline-block text-[15px] text-black/60 underline underline-offset-2 hover:text-black">
        Back to cart
      </Link>
    </section>
  )
}
