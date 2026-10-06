import { Link } from 'react-router-dom'
import { Phone, Mail } from 'lucide-react'
import Newsletter from './Newsletter'
import Logo from './Logo'
import { site } from '../data/site'
const Col = ({ title, links }) => (<div className="min-w-0"><h3 className="text-[22px] font-medium">{title}</h3><ul className="mt-6 space-y-4 text-[17px] text-[#4A2C23]/85">{links.map((l) => <li key={l.label}><Link to={l.to} className="hover:underline">{l.label}</Link></li>)}</ul></div>)
export default function Footer() {
  return (
    /* The footer sits on the logo's own sampled cream (`#FAF0E7`) so the mark
       blends in with no rectangle behind it. Text/borders flip from white to
       the site's cocoa `#4A2C23` — same type, size, weight and layout — simply
       because white on cream would be unreadable. */
    <footer className="bg-[#FAF0E7] text-[#4A2C23]">
      <div className="max-w-[1600px] mx-auto px-6 md:px-[8%] pt-20 pb-6">
        {/* Four columns from `xl`: the brand block, then Shop, Customer
            service and Contact spread at equal intervals — the first three
            tracks are 1fr each, so the left edges sit exactly one step apart.
            The contact track is wider only because it carries Stay updated
            directly beneath it. Below `xl` the blocks stack two per row. */}
        <div className="grid gap-12 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <div className="min-w-0"><Logo light /><p className="mt-6 text-[17px] leading-7 max-w-[280px] text-[#4A2C23]/90">{site.tagline}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-6 text-[15px]">{site.social.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{s.label}</a>)}</div></div>
          <Col title="Shop" links={site.shopLinks} /><Col title="Customer service" links={site.service} />
          <div className="min-w-0">
            <div>
              <h3 className="text-[22px] font-medium">Contact us</h3>
              {/* `shrink-0` keeps the icons at their real size — without it a
                  flex row squeezes the SVG to nothing when the e-mail address
                  is wider than the column. */}
              <ul className="mt-6 space-y-4 text-[17px]">
                <li className="flex gap-3 items-center min-w-0"><Phone size={20} className="shrink-0" />{site.phone}</li>
                <li className="flex gap-3 items-center min-w-0"><Mail size={20} className="shrink-0" /><span className="min-w-0 break-all">{site.email}</span></li></ul>
            </div>
            <div className="mt-10"><h3 className="text-[22px] font-medium">Stay updated</h3><p className="mt-6 text-[17px] leading-7 max-w-[300px]">Subscribe to get updates on new arrivals and offers.</p><Newsletter /></div>
          </div>
        </div>
        <div className="mt-16 border-t border-[#4A2C23]/25 pt-8 flex flex-wrap gap-4 justify-between items-center">
          <p className="text-[#4A2C23]/70 text-[15px]">© {new Date().getFullYear()} {site.name}. All rights reserved. {site.legal.map((l) => <Link key={l.to} to={l.to} className="ml-4 underline-offset-4 hover:underline">{l.label}</Link>)}</p>
        </div>
      </div>
    </footer>
  )
}
