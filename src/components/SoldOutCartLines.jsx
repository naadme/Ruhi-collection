import { Link } from 'react-router-dom'
import Img from './Img'
import { inStockSizes } from '../lib/stock'

// Basket lines whose colour sold out in their size after they were added
// (20 Nov 2026). They stay on screen and say so, are never charged or ordered
// (src/context/CartContext.jsx keeps them out of `lines`), and offer the same
// set in her size: one tap removes the line, another opens a colour in stock.
export default function SoldOutCartLines({ lines, onRemove, onGo, className = '' }) {
  if (!lines?.length) return null
  return (
    <ul className={`space-y-3 ${className}`}>
      {lines.map((l) => {
        const size = encodeURIComponent(l.size)
        const others = (l.product.colors || []).filter((c) => c.id !== l.id && inStockSizes(c).includes(l.size))
        return (
          <li key={l.id + l.size} className="flex gap-4 border border-amber-300 bg-amber-50 rounded-xl p-3">
            <Img src={l.image} alt={l.product.title} sizes="64px" className="w-16 h-20 object-cover opacity-60" />
            <div className="flex-1 min-w-0 text-[15px]">
              <p className="leading-tight">{l.product.title}</p>
              <p className="text-sm text-black/60">Size: {l.size}{l.color ? ` · ${l.color}` : ''}</p>
              <p className="text-sm font-semibold text-amber-900 mt-1">Sold out since you added it, so it isn&apos;t in your total.</p>
              <p className="text-sm mt-1">
                {others.length ? (
                  <>
                    In stock in {l.size}:{' '}
                    {others.slice(0, 2).map((c, i) => (
                      <span key={c.id}>
                        {i ? ' · ' : ''}
                        <Link to={`/product/${c.id}?size=${size}`} onClick={onGo} className="underline underline-offset-2">{c.color}</Link>
                      </span>
                    ))}
                    {others.length > 2 && <> · <Link to={`/product/${l.id}?size=${size}`} onClick={onGo} className="underline underline-offset-2">more</Link></>}
                  </>
                ) : (
                  <Link to={`/product/${l.id}?size=${size}`} onClick={onGo} className="underline underline-offset-2">See similar styles</Link>
                )}
              </p>
              <button onClick={() => onRemove(l.id, l.size)} className="text-sm underline mt-2">Remove</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
