import usePageTitle from '../hooks/usePageTitle'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
export default function Account() {
  usePageTitle('Sign in')
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false)
  return (
    <section className="min-h-screen flex flex-col items-center pt-16 pb-10 font-ui">
      <p className="text-2xl font-semibold">Rohi Collection</p>
      <div className="w-full max-w-[400px] mt-32 px-4">
        <h1 className="text-[28px] font-bold">Sign in</h1><p className="text-black/60 mt-2">Sign in or create an account</p>
        <button className="w-full h-14 mt-6 rounded-xl bg-[#5433eb] text-white font-semibold text-lg">Continue with shop</button>
        <div className="flex items-center gap-4 my-5 text-black/60"><hr className="flex-1" />or<hr className="flex-1" /></div>
        {sent ? <p className="text-green-700">Sign-in is coming soon. We have noted {email}.</p> :
          <form onSubmit={(e) => { e.preventDefault(); setSent(true) }} className="flex items-center border rounded-xl h-14 px-4"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="flex-1 outline-none" /><button aria-label="Continue"><ArrowRight size={20} /></button></form>}
      </div>
      <Link to="/" className="text-blue-700 mt-16">Privacy policy</Link>
    </section>
  )
}
