import { useState } from 'react'
export default function Newsletter() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false)
  const submit = (e) => { e.preventDefault(); if (email) { setDone(true); setEmail('') } }
  return done ? <p className="mt-4 font-ui">Thanks for subscribing!</p> : (
    <form onSubmit={submit} className="flex gap-3 mt-6 max-w-[430px] flex-wrap sm:flex-nowrap">
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="flex-1 min-w-0 h-14 px-4 bg-white text-black font-ui rounded-sm outline-none" />
      <button className="bg-[#1a73f5] hover:bg-blue-700 text-white px-6 font-ui font-medium rounded-sm">Subscribe</button>
    </form>
  )
}
