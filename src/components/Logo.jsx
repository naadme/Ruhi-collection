import { Link } from 'react-router-dom'
export default function Logo({ light }) {
  return (
    <Link to="/" aria-label="Rohi Collection — home" className="leading-none shrink-0 block">
      <span className={`block font-serif font-bold text-[40px] tracking-[.14em] ${light ? 'text-white' : 'text-[#166a3a]'}`}>ROHI</span>
      <span className={`block font-ui font-semibold text-[11px] tracking-[.5em] mt-1 ${light ? 'text-[#f5c300]' : 'text-[#c9a400]'}`}>COLLECTION</span>
    </Link>
  )
}
