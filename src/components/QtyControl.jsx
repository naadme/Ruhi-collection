import { Minus, Plus } from 'lucide-react'
export default function QtyControl({ qty, onChange, small }) {
  const h = small ? 'h-9 w-9' : 'h-12 w-12'
  return (
    <div className="inline-flex items-center border border-black/50 rounded-md font-ui">
      <button className={`${h} grid place-items-center`} onClick={() => onChange(Math.max(1, qty - 1))} aria-label="Decrease"><Minus size={14} /></button>
      <span className={`${small ? 'w-8' : 'w-12'} text-center`}>{qty}</span>
      <button className={`${h} grid place-items-center`} onClick={() => onChange(qty + 1)} aria-label="Increase"><Plus size={14} /></button>
    </div>
  )
}
