import { useEffect, useRef, useState } from 'react'
import { useProducts } from '../context/ProductsContext'
import { colourOf } from '../lib/productForm'
import { soldOutSizes } from '../lib/stock'
import { sellsOutDesign } from '../lib/stockAdmin'
import { setSoldOut } from './stockApi'

// One colour's sizes as buttons (20 Nov 2026): tap a size when its last piece
// goes, tap it again when it is back. Each tap saves at once, says what it did
// and offers Undo. "Whole colour sold out" marks every size in one tap. Only
// the tap that would leave the whole design sold out asks first, because that
// takes it out of every list and out of the ads.
//
// Used on the Stock screen (StockPanel.jsx) and on each colour of the product
// editor. `rows` are all the colours of the design, for that one question.
// Styles: admin.css (`adm-size…`), so the shop's stylesheet does not grow.
export default function SoldOutChips({ row, rows, designName = '' }) {
  const { applyRow } = useProducts()
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(null) // sizes waiting for the "whole design" answer
  const [note, setNote] = useState(null) // { text, error?, undo? }
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const sizes = Array.isArray(row.sizes) ? row.sizes : []
  const out = soldOutSizes(row)
  const allOut = sizes.length > 0 && sizes.every((s) => out.includes(s))
  const colour = colourOf(row) || 'This colour'

  const say = (next) => {
    clearTimeout(timer.current)
    setNote(next)
    // Long enough to notice a wrong tap on a phone and press Undo.
    if (next && !next.error) timer.current = setTimeout(() => setNote(null), 20000)
  }

  const run = async (marks, soldOut, offerUndo = true) => {
    setAsk(null)
    setBusy(true)
    try {
      const saved = await setSoldOut(row.id, marks, soldOut)
      applyRow(saved)
      const what = marks.length === sizes.length ? 'every size' : marks.join(', ')
      say({
        text: `${colour} · ${what} ${soldOut ? 'marked sold out' : 'back in stock'}.`,
        undo: offerUndo ? () => run(marks, !soldOut, false) : null,
      })
    } catch (e) {
      say({ text: e.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  const mark = (marks, soldOut) => {
    if (!marks.length) return
    if (soldOut && sellsOutDesign(rows, row.id, marks)) { setAsk(marks); return }
    run(marks, soldOut)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Sold out sizes of ${colour}`}>
        {sizes.map((s) => {
          const isOut = out.includes(s)
          return (
            <button
              key={s}
              type="button"
              disabled={busy}
              aria-pressed={isOut}
              aria-label={`${s}: ${isOut ? 'sold out, tap when it is back' : 'in stock, tap when it sells out'}`}
              onClick={() => mark([s], !isOut)}
              className={`adm-size${isOut ? ' adm-size--out' : ''}`}
            >
              {s}
            </button>
          )
        })}
        <button
          type="button"
          disabled={busy || !sizes.length}
          onClick={() => (allOut ? run(sizes, false) : mark(sizes.filter((s) => !out.includes(s)), true))}
          className="adm-size-all"
        >
          {allOut ? 'Back in stock' : 'Whole colour sold out'}
        </button>
      </div>

      {ask && (
        <div role="alertdialog" aria-label="Mark the last size sold out?" className="adm-soldout-ask">
          <p><b>Mark the last size sold out?</b></p>
          <ul>
            <li>Every colour and size of {designName || 'this design'} will be sold out.</li>
            <li>Its page stays open and shows similar styles.</li>
            <li>It leaves the shop, search, recommendations and the homepage.</li>
            <li>Meta and Google stop showing it after they next read the feed. Video ads can still send people to it.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="adm-btn adm-btn--dark" onClick={() => run(ask, true)}>Mark sold out</button>
            <button type="button" className="adm-btn" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      )}

      {note && (
        <p role={note.error ? 'alert' : 'status'} className={`adm-soldout-note${note.error ? ' adm-soldout-note--error' : ''}`}>
          {note.text}
          {note.undo && <button type="button" className="adm-link" onClick={note.undo}>Undo</button>}
        </p>
      )}
    </div>
  )
}
