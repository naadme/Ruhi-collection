import { Minus, Plus } from 'lucide-react'
import { MAX_QTY } from '../lib/checkout'

export default function QtyControl({ qty, onChange, small }) {
  const h = small ? 'h-9 w-9' : 'h-12 w-12'
  const atMin = qty <= 1
  const atMax = qty >= MAX_QTY
  // Both ends are blocked here so the buttons advertise the limit the database
  // enforces; CartContext clamps again in case a value arrives some other way.
  return (
    <div className="inline-flex items-center border border-black/50 rounded-lg font-ui">
      <button
        type="button" className={`${h} grid place-items-center disabled:opacity-40`}
        onClick={() => onChange(Math.max(1, qty - 1))} disabled={atMin} aria-label="Decrease"
      ><Minus size={14} /></button>
      <span className={`${small ? 'w-8' : 'w-12'} text-center`}>{qty}</span>
      <button
        type="button" className={`${h} grid place-items-center disabled:opacity-40`}
        onClick={() => onChange(qty + 1)} disabled={atMax}
        aria-label={`Increase${atMax ? ` (maximum ${MAX_QTY} reached)` : ''}`}
      ><Plus size={14} /></button>
    </div>
  )
}
