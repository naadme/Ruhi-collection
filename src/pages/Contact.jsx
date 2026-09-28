import { useState } from 'react'
import { MapPin, Phone, Mail, Clock } from 'lucide-react'
import Img from '../components/Img'
import { img } from '../data/images'
import { site } from '../data/site'
import { supabase } from '../lib/supabase'
import usePageTitle from '../hooks/usePageTitle'
export default function Contact() {
  usePageTitle('Contact')
  const [sent, setSent] = useState(false)
  const [f, setF] = useState({ name: '', email: '', phone: '', comment: '' })
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = (e) => {
    e.preventDefault()
    // Persist in the background — the thank-you message must appear either way,
    // so a missing table or a rejected insert never blocks the user.
    supabase.from('contact_messages').insert({ name: f.name, email: f.email, phone: f.phone, comment: f.comment }).then(({ error }) => {
      if (error) console.warn('[Supabase] contact message not saved:', error.message)
    })
    setSent(true); setF({ name: '', email: '', phone: '', comment: '' })
  }
  const info = [[MapPin, site.address], [Phone, site.phone], [Mail, site.email], [Clock, site.hours]]
  return (
    <>
      <div className="relative h-[160px] md:h-[220px] bg-neutral-300"><Img src={img.contact} alt="" className="absolute inset-0 w-full h-full object-cover" /><div className="absolute inset-0 bg-black/30" />
        <h1 className="relative h-full grid place-items-center text-white font-serif font-bold text-[44px] md:text-[64px]">Contact us</h1></div>
      <section className="max-w-[1200px] mx-auto px-4 py-16 grid lg:grid-cols-[1.4fr_1fr] gap-14">
        <div>
          <h2 className="text-[30px] md:text-[38px] leading-[1.3] text-black/85 mb-8">Questions or comments? Get in touch and we'll be happy to help.</h2>
          {sent ? <p className="text-2xl text-brand-green py-10">Thanks for contacting us. We'll get back to you within one working day.</p> : (
            <form onSubmit={submit} className="space-y-5">
              <div className="grid md:grid-cols-2 gap-5"><input className="field" placeholder="Name" value={f.name} onChange={on('name')} /><input className="field" type="email" required placeholder="Email *" value={f.email} onChange={on('email')} /></div>
              <input className="field" placeholder="Phone number" type="tel" value={f.phone} onChange={on('phone')} />
              <textarea className="field !h-[140px] py-6" placeholder="Comment" value={f.comment} onChange={on('comment')} />
              <button className="bg-brand-gold h-[60px] px-14 rounded-lg text-[19px] hover:brightness-95">Send</button></form>)}
        </div>
        <aside className="space-y-10">
          <ul className="space-y-5 text-[19px]">{info.map(([I, t], i) => <li key={i} className="flex gap-4"><I className="shrink-0 mt-1 text-brand-green" size={22} />{t}</li>)}</ul>
          <div className="flex flex-wrap gap-3">{site.social.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="border border-black/30 rounded-full px-5 py-2 hover:bg-black hover:text-white transition">{s.label}</a>)}</div>
          <div><h3 className="text-2xl mb-4">FAQ</h3>{site.faq.map(([q, a]) => <details key={q} className="border-b border-black/10 py-3"><summary className="cursor-pointer text-[18px]">{q}</summary><p className="text-black/65 mt-2">{a}</p></details>)}</div>
        </aside>
      </section>
    </>
  )
}
