import { Link } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle'

export default function NotFound() {
  usePageTitle('Page not found')
  return (
    <section className="text-center py-32 px-4">
      <p className="font-ui text-[15px] tracking-[.2em] text-black/45 uppercase">404</p>
      <h1 className="text-[44px] mt-3">This page can't be found</h1>
      <p className="text-xl text-black/60 mt-4">The link may be old or mistyped.</p>
      <div className="flex flex-wrap gap-3 justify-center mt-8">
        <Link to="/" className="inline-block bg-brand-yellow font-bold px-10 py-4 rounded-lg">Back to home</Link>
        <Link to="/shop" className="btn-outline">Shop all</Link>
        <Link to="/collections" className="btn-outline">Collections</Link>
      </div>
    </section>
  )
}
