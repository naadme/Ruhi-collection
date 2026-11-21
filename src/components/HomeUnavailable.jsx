import { Link } from 'react-router-dom'

// Shown on the homepage when its code could not be fetched, even after one
// retry (src/lib/pageChunk.js): a dropped connection, or a tab opened before
// the site was updated. Kept in the main bundle: it must work when the
// homepage can't. The shop itself still opens.
export default function HomeUnavailable() {
  return (
    <section role="alert" className="max-w-md mx-auto px-4 py-24 text-center">
      <h1 className="text-[32px] leading-tight">The homepage didn't load</h1>
      <p className="mt-4 text-[17px] text-black/65">Please check your connection and reload the page.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-8 w-full h-[54px] rounded-lg bg-brand-cta text-white text-[17px] font-semibold hover:bg-brand-cta-hover transition">
        Reload the page
      </button>
      <Link to="/shop" className="mt-5 inline-block text-[15px] text-black/60 underline underline-offset-2 hover:text-black">Go to the shop</Link>
    </section>
  )
}
