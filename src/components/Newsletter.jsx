import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2 } from 'lucide-react'

export default function Newsletter() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | busy | done | error
  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || status === 'busy') return
    setStatus('busy')
    // Subscribing is a background nicety — but the shopper should know if it
    // did not go through, rather than being thanked for a row that was lost.
    const { error } = await supabase.from('newsletter_subscribers').insert({ email: email.trim() })
    if (error) {
      // A duplicate is not a failure worth alarming anyone about.
      if (/duplicate|unique/i.test(error.message || '')) setStatus('done')
      else setStatus('error')
      return
    }
    setStatus('done')
    setEmail('')
  }

  if (status === 'done') return <p className="mt-4 font-ui" role="status">Thanks for subscribing!</p>

  return (
    <>
      <form onSubmit={submit} className="flex gap-3 mt-6 w-full max-w-[430px] flex-wrap sm:flex-nowrap">
        <label className="sr-only" htmlFor="newsletter-email">Email address</label>
        <input
          id="newsletter-email" type="email" required value={email}
          onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
          placeholder="Enter your email" disabled={status === 'busy'}
          className="flex-1 min-w-0 h-14 px-4 bg-white text-black font-ui rounded-sm outline-none disabled:opacity-70"
        />
        <button
          disabled={status === 'busy'}
          className="bg-[#C08576] hover:bg-blue-700 text-white px-6 font-ui font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-70"
        >
          {status === 'busy' && <Loader2 size={16} className="animate-spin" />}
          {status === 'busy' ? 'Joining…' : 'Subscribe'}
        </button>
      </form>
      {status === 'error' && (
        <p role="alert" className="mt-3 font-ui text-[14px] text-red-600">
          We couldn't add you right now — please try again in a moment.
        </p>
      )}
    </>
  )
}
