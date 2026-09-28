import { Link } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle'
export default function NotFound() {
  usePageTitle('Page not found')
  return (<section className="text-center py-32 px-4"><h1 className="text-[44px]">This page can't be found</h1><p className="text-xl text-black/60 mt-4">The link may be old or mistyped.</p>
    <Link to="/" className="inline-block bg-brand-yellow font-bold px-10 py-4 rounded-lg mt-8">Back to home</Link></section>)
}
