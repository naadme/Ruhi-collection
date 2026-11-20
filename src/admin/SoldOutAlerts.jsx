import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useProducts } from '../context/ProductsContext'
import { colourOf } from '../lib/productForm'
import { groupRows } from '../lib/productGrouping'
import { alertTiming, bestColourInStock } from '../lib/stockAdmin'
import { closeAlert, fetchOpenAlerts, fetchPaidPieces } from './stockApi'

// The sold-out alert at the top of the dashboard (20 Nov 2026, the owner's
// decision 4). When a live colour sells out in every size, it shows at once;
// after 24 hours it becomes a reminder: if an ad sends people to that colour,
// change the ad's link to the best colour in stock. Changing the ad is done
// by hand in Meta: nothing here touches an ad, and the shop never redirects.
//
// The database keeps the alerts (sold_out_alerts, 20261120210000_sold_out.sql):
// one per colour from the moment it sold out, gone when it is back in stock,
// closed with "Done". The dashboard cannot know which colours an ad uses, so
// every sold-out colour gets one. Colours of the same design are shown as one
// item, timed from the first of them to sell out.

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
})
const names = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

export default function SoldOutAlerts() {
  const { all } = useProducts()
  const [alerts, setAlerts] = useState([])
  const [pieces, setPieces] = useState(new Map())
  const [now, setNow] = useState(() => Date.now())
  const [note, setNote] = useState('')

  // Read again whenever a sold-out mark changes anywhere in the catalogue.
  const marks = useMemo(
    () => all.map((r) => `${r.id}:${r.is_active ? 1 : 0}:${(r.sold_out_sizes || []).join('|')}`).join(','),
    [all],
  )
  useEffect(() => {
    let alive = true
    fetchOpenAlerts().then((rows) => { if (alive) setAlerts(rows) }).catch(() => { /* the dashboard is not the alert */ })
    return () => { alive = false }
  }, [marks])
  // The countdown moves on its own while the dashboard stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // One item per design: its sold-out colours, since the first of them.
  const items = useMemo(() => {
    const byDesign = new Map()
    for (const g of groupRows(all)) {
      const open = alerts.filter((a) => g.rows.some((r) => r.id === a.product_id))
      if (!open.length) continue
      const rows = open.map((a) => g.rows.find((r) => r.id === a.product_id))
      const since = open.map((a) => a.sold_out_at).sort()[0]
      byDesign.set(g.key, { key: g.key, design: g, rows, ids: rows.map((r) => r.id), since })
    }
    return [...byDesign.values()].sort((a, b) => a.since.localeCompare(b.since))
  }, [alerts, all])

  // Paid pieces of the colours involved, to choose the best colour in stock.
  const ids = useMemo(() => [...new Set(items.flatMap((x) => x.design.rows.map((r) => r.id)))], [items])
  const idsKey = ids.join(',')
  useEffect(() => {
    let alive = true
    fetchPaidPieces(ids).then((m) => { if (alive) setPieces(m) })
    return () => { alive = false }
  }, [idsKey])

  if (!items.length) return null

  const done = async (item) => {
    try {
      await Promise.all(item.ids.map((id) => closeAlert(id)))
      setAlerts((list) => list.filter((a) => !item.ids.includes(a.product_id)))
    } catch (e) {
      setNote(e.message)
    }
  }
  const copy = async (link) => {
    try {
      await navigator.clipboard.writeText(link)
      setNote('Link copied. Paste it as the ad’s website URL in Meta.')
    } catch {
      setNote(link)
    }
  }

  return (
    <section aria-label="Sold-out alerts" className="adm-soldout-alert">
      <p className="adm-soldout-alert-title"><AlertTriangle size={18} /> Sold out in every size</p>
      <ul>
        {items.map((item) => {
          const { design, rows, since } = item
          const colours = names(rows.map((r) => colourOf(r) || 'one colour'))
          const allColours = rows.length === design.rows.filter((r) => r.is_active).length
          const best = bestColourInStock(design.rows, rows[0].id, pieces)
          const bestColour = best ? colourOf(best) || best.title : ''
          const link = best ? `${window.location.origin}/product/${best.id}` : ''
          const { due, hoursLeft } = alertTiming(since, now)
          return (
            <li key={item.key} className={`adm-soldout-alert-item${due ? ' adm-soldout-alert-item--due' : ''}`}>
              <p>
                <b>{design.name}{allColours ? ' (every colour)' : ` · ${colours}`}</b> has been sold out in every size since {when.format(new Date(since))}.
              </p>
              {!best ? (
                <p>If an ad sends people to this style, point the ad at another one: its page now shows similar styles.</p>
              ) : due ? (
                <p>
                  <b>24 hours have passed.</b> If an ad sends people to {colours}, change the ad&apos;s website URL in
                  Meta to <b>{bestColour}</b>, the best colour in stock.
                </p>
              ) : (
                <p>
                  Its page now shows the colours in stock. If an ad sends people to it, you&apos;ll be reminded in
                  about {hoursLeft} {hoursLeft === 1 ? 'hour' : 'hours'} to point the ad at <b>{bestColour}</b>.
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {best && <button type="button" className="adm-btn" onClick={() => copy(link)}>Copy {bestColour} link</button>}
                <button type="button" className="adm-btn" onClick={() => done(item)}>Done</button>
              </div>
            </li>
          )
        })}
      </ul>
      {note && <p role="status" className="adm-soldout-note">{note}</p>}
    </section>
  )
}
