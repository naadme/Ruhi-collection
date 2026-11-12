import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { site } from '../data/site'
import { WHATSAPP_GLYPH } from './WhatsAppButton'

// Checkout's own header (12 Nov 2026). The shop's header, menus, announcement
// strip and footer are left out of this page (Layout.jsx), so nothing leads
// away from paying. What stays: the way back to the cart, the logo, and
// WhatsApp: "Chat with us" with the hours someone answers, in WhatsApp's deep
// green with white text, so a question never means leaving to find a number.
export default function CheckoutHeader({ chatHref, onChat }) {
  return (
    <header className="sticky top-0 z-40 bg-[#FAF0E7] border-b border-black/10">
      <div className="max-w-[1100px] mx-auto h-[60px] pl-1 pr-3 md:px-7 flex items-center gap-1">
        <Link to="/cart" aria-label="Back to cart" className="p-2.5 rounded-full text-black/70 hover:text-black">
          <ArrowLeft size={22} />
        </Link>
        <Link to="/" aria-label={`${site.name} — home`} className="shrink-0">
          <img src="/images/ruhi-logo-320.jpg" alt={site.name} width={320} height={208} className="block h-10 w-auto" />
        </Link>
        <a
          href={chatHref}
          onClick={onChat}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Chat with us on WhatsApp, ${site.supportHours}`}
          className="ml-auto inline-flex items-center gap-2 h-10 pl-1.5 pr-3.5 rounded-full bg-[#0A8040] hover:bg-[#08703A] text-white shadow-[0_2px_8px_rgba(10,128,64,0.3)]"
        >
          <span className="grid place-items-center w-7 h-7 rounded-full bg-white shrink-0" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="#0A8040"><path d={WHATSAPP_GLYPH} /></svg>
          </span>
          <span className="font-ui text-left leading-none whitespace-nowrap" aria-hidden="true">
            <span className="block text-[14px] font-semibold">Chat with us</span>
            <span className="block text-[11px] mt-[3px]">{site.supportHours}</span>
          </span>
        </a>
      </div>
    </header>
  )
}
