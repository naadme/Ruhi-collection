import { Link } from 'react-router-dom'
import { Phone, Mail } from 'lucide-react'
import Newsletter from './Newsletter'
import Logo from './Logo'
import { site } from '../data/site'
const Col = ({ title, links }) => (<div className="min-w-0"><h3 className="text-[22px] font-medium">{title}</h3><ul className="mt-6 space-y-4 text-[17px] text-[#4A2C23]/85">{links.map((l) => <li key={l.label}><Link to={l.to} className="hover:underline">{l.label}</Link></li>)}</ul></div>)
const PAYMENT_TITLES = { COD: 'Cash on delivery', UPI: 'Pay by UPI', Cards: 'Credit and debit cards' }
export default function Footer() {
  return (
    /* The footer sits on the logo's own sampled cream (`#FAF0E7`) so the mark
       blends in with no rectangle behind it. Text/borders flip from white to
       the site's cocoa `#4A2C23` — same type, size, weight and layout — simply
       because white on cream would be unreadable. */
    <footer className="bg-[#FAF0E7] text-[#4A2C23]">
      <div className="max-w-[1600px] mx-auto px-6 md:px-[8%] pt-20 pb-6">
        {/* Five columns only from `xl`; below that the newsletter form and the
            service links cannot be squeezed into the row without overflowing. */}
        <div className="grid gap-12 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1.3fr_1.5fr]">
          <div className="min-w-0"><Logo light /><p className="mt-6 text-[17px] leading-7 max-w-[280px] text-[#4A2C23]/90">{site.tagline}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-6 text-[15px]">{site.social.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{s.label}</a>)}</div></div>
          <Col title="Shop" links={site.shopLinks} /><Col title="Customer service" links={site.service} />
          <div className="min-w-0"><h3 className="text-[22px] font-medium">Contact us</h3>
            <ul className="mt-6 space-y-4 text-[17px]">
              <li className="flex gap-3 items-center"><Phone size={20} />{site.phone}</li>
              <li className="flex gap-3 items-center"><Mail size={20} />{site.email}</li></ul></div>
          <div className="min-w-0"><h3 className="text-[22px] font-medium">Stay updated</h3><p className="mt-6 text-[17px] leading-7 max-w-[300px]">Subscribe to get updates on new arrivals and offers.</p><Newsletter /></div>
        </div>
        <div className="mt-16 border-t border-[#4A2C23]/25 pt-8 flex flex-wrap gap-4 justify-between items-center">
          <p className="text-[#4A2C23]/70 text-[15px]">© {new Date().getFullYear()} {site.name}. All rights reserved. {site.legal.map((l) => <Link key={l.to} to={l.to} className="ml-4 underline-offset-4 hover:underline">{l.label}</Link>)}</p>
          <div className="flex gap-3">{site.payments.map((b) => (
            <span key={b} title={PAYMENT_TITLES[b] || b}
              className="bg-white text-black text-[12px] font-ui font-extrabold px-3 py-2 rounded min-w-[52px] text-center">{b}</span>
          ))}</div>
        </div>
      </div>
    </footer>
  )
}
