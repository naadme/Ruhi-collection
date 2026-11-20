import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useProducts } from '../context/ProductsContext'
import { colourOf } from '../lib/productForm'
import { groupRows } from '../lib/productGrouping'
import { stockLabel, stockSummary } from '../lib/stockAdmin'
import SoldOutChips from './SoldOutChips'

// The Stock screen (20 Nov 2026), made for the owner's phone. The one habit:
// when the last piece of a colour in a size goes — sold on the site, on
// Instagram or on WhatsApp — tap that size here. When it comes back, tap it
// again. The shop, recommendations, the cart, the feed and the ads follow by
// themselves (Sold_Out_Proposal_2026-11-20.html, section 7).
//
// Only live colours are listed: a hidden colour is one we stopped selling,
// which is the Products screen's job.

const FILTERS = [['all', 'All'], ['some', 'Some sold out'], ['out', 'All sold out']]

export default function StockPanel() {
  const { all } = useProducts()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState({})

  const designs = useMemo(
    () => groupRows(all.filter((r) => r.is_active)).map((g) => ({ ...g, summary: stockSummary(g.rows) })),
    [all],
  )
  const counts = useMemo(() => ({
    all: designs.length,
    some: designs.filter((d) => d.summary.sizesOut > 0 && !d.summary.allOut).length,
    out: designs.filter((d) => d.summary.allOut).length,
  }), [designs])

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return designs.filter((d) => {
      if (filter === 'some' && !(d.summary.sizesOut > 0 && !d.summary.allOut)) return false
      if (filter === 'out' && !d.summary.allOut) return false
      if (!words.length) return true
      const hay = [d.name, ...d.rows.flatMap((r) => [r.title, r.id, r.sku, colourOf(r)])].join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [designs, filter, query])

  return (
    <div>
      <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Stock</h1>
      <p className="text-black/55 mt-2 text-[15px]">
        When the last piece of a size goes, tap it. Tap it again when it is back. Shoppers still see a sold-out size,
        struck through, with other colours and similar styles to buy.
      </p>

      <div className="mt-6 flex flex-wrap gap-3 items-center justify-between border-y border-black/10 py-4">
        <div className="adm-strip flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3.5 h-9 rounded-lg text-[14px] font-medium transition ${filter === k ? 'bg-black text-white' : 'text-black/60 hover:text-black'}`}
            >
              {label}
              <span className={`ml-1.5 text-[12px] ${filter === k ? 'text-white/70' : 'text-black/40'}`}>{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px] sm:max-w-[320px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, colour or Product ID…"
            aria-label="Search stock"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-black/20 bg-white text-[14px] outline-none focus:border-black focus:ring-2 focus:ring-black/10"
          />
        </div>
      </div>

      {!shown.length ? (
        <p className="text-black/55 text-[15px] mt-6">
          {filter === 'all' ? 'No product matches that search.' : 'Nothing here: no design is in this state.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((d) => {
            // One colour: its sizes right away. Several: open the design.
            const single = d.rows.length === 1
            const expanded = single || Boolean(open[d.key]) || Boolean(query.trim())
            const label = stockLabel(d.summary)
            return (
              <li key={d.key} className="bg-white border border-black/10 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => !single && setOpen((o) => ({ ...o, [d.key]: !o[d.key] }))}
                  aria-expanded={expanded}
                  className="w-full p-3 sm:p-4 flex items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[16px] leading-snug truncate">{d.name}</span>
                    <span className="block text-[13px] text-black/50 mt-0.5">
                      {d.rows.length} {d.rows.length === 1 ? 'colour' : 'colours'} · {label ? <b className="adm-soldout-tag">{label}</b> : 'all in stock'}
                    </span>
                  </span>
                  {!single && (expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />)}
                </button>
                {expanded && (
                  <ul className="border-t border-black/10 divide-y divide-black/5 bg-[#FCFBF9]">
                    {d.rows.map((r) => (
                      <li key={r.id} className="px-3 sm:px-4 py-3">
                        <p className="font-semibold text-[14px] mb-2">{colourOf(r) || 'No colour'}</p>
                        <SoldOutChips row={r} rows={d.rows} designName={d.name} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
