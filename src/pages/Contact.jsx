import { useState } from 'react'
import { AlertTriangle, Clock, Loader2, Mail, Phone, Instagram, MessageCircle } from 'lucide-react'
import Img from '../components/Img'
import { img } from '../data/images'
import { site } from '../data/site'
import { sendContactMessage } from '../lib/contact'
import { emailOk } from '../lib/checkout'
import usePageTitle from '../hooks/usePageTitle'

// Which glyph each social pill shows. `site.social` still supplies the URL —
// this only swaps the word for the matching icon.
const SOCIAL_ICON = { Instagram, WhatsApp: MessageCircle }

const EMPTY = { name: '', email: '', phone: '', comment: '' }

// `noValidate` because the browser's own bubbles don't match this design — so
// the same rules have to be enforced here, before a row reaches Supabase.
function validate(values) {
  const errors = {}
  if (values.name.trim().length < 2) errors.name = 'Please enter your name.'
  if (!emailOk(values.email)) errors.email = 'Enter a valid email address.'
  // Phone is optional, but if it is given it must still look like a number —
  // otherwise the round trip fails after the shopper has typed everything.
  if (values.phone.trim() && !/^[0-9+()\-\s]{1,30}$/.test(values.phone.trim())) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (values.comment.trim().length < 5) errors.comment = 'Please tell us how we can help.'
  return errors
}

export default function Contact() {
  usePageTitle('Contact', 'Questions about an order, a size or a return? Get in touch with the Ruhi Womens Clothing team — we reply within one working day.')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  // Holds the failure sentence itself, not a flag, so the shopper is told what
  // actually went wrong instead of a bare "something failed".
  const [failed, setFailed] = useState('')
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const on = (k) => (e) => {
    const value = e.target.value
    setF((prev) => ({ ...prev, [k]: value }))
    // Clear the message as soon as the shopper starts fixing it.
    setErrors((prev) => {
      if (!prev[k]) return prev
      const next = { ...prev }
      delete next[k]
      return next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const found = validate(f)
    setErrors(found)
    if (Object.keys(found).length) {
      // Put focus back on the first field that needs attention.
      const order = ['name', 'email', 'phone', 'comment']
      const first = order.find((k) => found[k])
      if (first) document.getElementById(`ct-${first === 'comment' ? 'comment' : first}`)?.focus()
      return
    }
    // `busy` doubles as the duplicate-submission lock: the button is disabled
    // while a request is in flight and a second submit event is ignored.
    setBusy(true); setFailed('')
    const result = await sendContactMessage(f)
    setBusy(false)
    if (!result.ok) {
      console.warn('[contact] message not sent:', result.message)
      // The fields are deliberately left exactly as typed so the shopper can
      // edit them and press Send again.
      setFailed(result.message)
      return
    }
    setSent(true); setF(EMPTY)
  }

  const info = [[Phone, site.phone], [Mail, site.email], [Clock, site.hours]]
  return (
    <>
      <div className="relative h-[160px] md:h-[220px] bg-neutral-300"><Img src={img.contact} alt="" loading="eager" className="absolute inset-0 w-full h-full object-cover" /><div className="absolute inset-0 bg-black/30" />
        <h1 className="relative h-full grid place-items-center text-white font-serif font-bold text-[44px] md:text-[64px]">Contact us</h1></div>
      <section className="max-w-[1200px] mx-auto px-4 py-16 grid lg:grid-cols-[1.4fr_1fr] gap-14">
        <div>
          <h2 className="text-[30px] md:text-[38px] leading-[1.3] text-black/85 mb-8">Questions or comments? Get in touch and we'll be happy to help.</h2>
          {sent ? (
            <div className="py-6" role="status">
              <p className="text-2xl text-brand-green">Thanks for contacting us. We'll get back to you within one working day.</p>
              <button onClick={() => { setSent(false); setFailed('') }} className="btn-outline mt-6">Send another message</button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-5">
              {failed && (
                <div role="alert" className="flex items-start gap-2 border border-red-200 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-[15px]">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  <div>
                    <p>{failed}</p>
                    <p className="mt-1">You can edit your message and try again, or email us directly at{' '}
                      <a href={`mailto:${site.email}`} className="underline underline-offset-2">{site.email}</a>.</p>
                  </div>
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="sr-only" htmlFor="ct-name">Name</label>
                  <input id="ct-name" className="field" placeholder="Name" required value={f.name} onChange={on('name')} aria-invalid={!!errors.name} />
                  {errors.name && <p className="text-red-700 text-[14px] mt-1.5">{errors.name}</p>}
                </div>
                <div>
                  <label className="sr-only" htmlFor="ct-email">Email</label>
                  <input id="ct-email" className="field" type="email" required placeholder="Email *" value={f.email} onChange={on('email')} aria-invalid={!!errors.email} />
                  {errors.email && <p className="text-red-700 text-[14px] mt-1.5">{errors.email}</p>}
                </div>
              </div>
              <div>
                <label className="sr-only" htmlFor="ct-phone">Phone number</label>
                <input id="ct-phone" className="field" placeholder="Phone number" type="tel" value={f.phone} onChange={on('phone')} aria-invalid={!!errors.phone} />
                {errors.phone && <p className="text-red-700 text-[14px] mt-1.5">{errors.phone}</p>}
              </div>
              <div>
                <label className="sr-only" htmlFor="ct-comment">Comment</label>
                <textarea id="ct-comment" className="field !h-[140px] py-6" placeholder="Comment *" required maxLength={2000} value={f.comment} onChange={on('comment')} aria-invalid={!!errors.comment} />
                {errors.comment && <p className="text-red-700 text-[14px] mt-1.5">{errors.comment}</p>}
              </div>
              <button disabled={busy} aria-busy={busy} className="bg-brand-gold h-[60px] px-14 rounded-lg text-[19px] hover:brightness-95 inline-flex items-center gap-2.5 disabled:opacity-70">
                {busy && <Loader2 size={18} className="animate-spin" />}
                {busy ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>
        <aside className="space-y-10">
          <div>
            {/* The brand sits above the channels so the panel reads as Ruhi's
                own contact block — same `site` source as the footer. */}
            <h3 className="text-2xl">{site.name}</h3>
            <ul className="mt-5 space-y-5 text-[19px]">{info.map(([I, t], i) => <li key={i} className="flex gap-4"><I className="shrink-0 mt-1 text-brand-green" size={22} aria-hidden="true" />{t}</li>)}</ul>
          </div>
          <div className="flex flex-wrap gap-3">{site.social.map((s) => { const I = SOCIAL_ICON[s.label]; return (<a key={s.label} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label} className="inline-flex items-center border border-black/30 rounded-full px-5 py-2 hover:bg-black hover:text-white transition">{I ? <I size={20} aria-hidden="true" /> : s.label}</a>) })}</div>
          <div><h3 className="text-2xl mb-4">FAQ</h3>{site.faq.map(([q, a]) => <details key={q} className="border-b border-black/10 py-3"><summary className="cursor-pointer text-[18px]">{q}</summary><p className="text-black/65 mt-2">{a}</p></details>)}</div>
        </aside>
      </section>
    </>
  )
}
