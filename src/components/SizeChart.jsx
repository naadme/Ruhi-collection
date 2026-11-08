import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Ruler, X } from 'lucide-react'
import useOverlay from '../hooks/useOverlay'
import { chartsFor, rowsFor, toCm } from '../lib/sizeCharts'

// Size charts: a small "Size chart" link beside the size picker that opens a
// compact sheet (a bottom sheet on phones), and the same tables on the
// /size-guide page. Nothing is added to the product page itself but the link.

/** One chart as a compact table; the shopper's chosen size is highlighted. */
export function SizeChartTable({ chart, sizes, unit = 'in', selected }) {
  const rows = rowsFor(chart, sizes)
  const show = (v) => (unit === 'cm' ? toCm(v) : v)
  return (
    <table className="w-full text-[14px] font-ui border-collapse">
      <thead>
        <tr className="text-left text-black/60">
          <th scope="col" className="py-2 pr-2 font-medium">Size</th>
          {chart.columns.map((c) => (
            <th key={c.key} scope="col" className="py-2 px-1.5 font-medium text-right">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const mine = selected && String(selected).toUpperCase() === r.size
          return (
            <tr key={r.size} className={`border-t border-black/10 ${mine ? 'bg-[#F5E9E1] font-semibold' : ''}`} aria-current={mine || undefined}>
              <th scope="row" className="py-2 pr-2 text-left font-semibold">{r.size}</th>
              {chart.columns.map((c) => (
                <td key={c.key} className="py-2 px-1.5 text-right tabular-nums">{show(r[c.key])}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** The charts for a category: Top / Bottom tabs when it has both, an in/cm
 *  switch, the table and one line on how to measure. */
export function SizeChartPanel({ type, sizes, selected, showAllRows = false }) {
  const charts = chartsFor(type)
  const [active, setActive] = useState(0)
  const [unit, setUnit] = useState('in')
  const chart = charts[Math.min(active, charts.length - 1)]
  const pill = (on) => `h-8 px-3 rounded-full text-[13px] font-ui transition ${on ? 'bg-black text-white' : 'border border-black/25 hover:border-black'}`
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {charts.length > 1 && charts.map((c, i) => (
          <button key={c.key} type="button" onClick={() => setActive(i)} aria-pressed={i === active} className={pill(i === active)}>
            {c.label}
          </button>
        ))}
        <div className="ml-auto flex gap-1" role="group" aria-label="Units">
          {['in', 'cm'].map((u) => (
            <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={unit === u} className={pill(unit === u)}>{u}</button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[13px] text-black/60">Body measurements in {unit === 'in' ? 'inches' : 'centimetres'}.</p>
      <SizeChartTable chart={chart} sizes={showAllRows ? [] : sizes} unit={unit} selected={selected} />
      <p className="mt-3 text-[13px] text-black/60 leading-5">
        <b className="font-medium text-black/75">How to measure:</b>{' '}
        {chart.howTo.map(([part, how], i) => (
          <span key={part}>{i > 0 && '; '}<span className="font-medium text-black/75">{part}</span> {how}</span>
        ))}.
      </p>
    </div>
  )
}

/** The "Size chart" link for a product page, and the sheet it opens.
 *  `onOpen` is told each time the shopper opens it (GA4's view_size_chart). */
export function SizeChartLink({ type, sizes, selected, onOpen }) {
  const [open, setOpen] = useState(false)
  const panel = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOverlay(open, close, panel)
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); onOpen?.() }} className="inline-flex items-center gap-1.5 text-[14px] underline underline-offset-4 text-black/80 hover:text-black">
        <Ruler size={15} aria-hidden="true" /> Size chart
      </button>
      {/* Rendered on <body>, so no positioned or transformed parent on the
          product page can shrink the sheet to its own box. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center" onClick={close}>
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Size chart"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:max-w-[520px] max-h-[85vh] overflow-y-auto bg-white rounded-t-2xl md:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] outline-none"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[20px] font-semibold">Size chart</h2>
              <button type="button" onClick={close} aria-label="Close size chart" className="w-11 h-11 -mr-2 grid place-items-center rounded-full hover:bg-black/5">
                <X size={20} />
              </button>
            </div>
            <SizeChartPanel type={type} sizes={sizes} selected={selected} />
            <Link to="/size-guide" onClick={close} className="inline-block mt-4 text-[13px] underline underline-offset-4 text-black/60 hover:text-black">
              Full size guide
            </Link>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
