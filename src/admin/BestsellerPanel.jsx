// Best Sellers management — the admin-only surface behind the "Bestsellers"
// section of the dashboard.
//
// The saved rows drive the homepage's Best Sellers row (src/components/
// Sections.jsx). This panel offers exactly the CARDS the storefront shows —
// one entry per design, built by the same `groupedCards()` rule — so a design
// promoted here can never be a card the shop does not already have.
//
// Nothing is stored but product ids and a position. No sales figure is
// invented, no order data is consulted, and no product is copied: the column
// is a shop-window choice, nothing more.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Search, Star, Trash2,
} from 'lucide-react'
import { fetchBestsellers, locatePicks, MAX_BESTSELLERS, saveBestsellers } from '../lib/bestsellers'
import { groupedCards } from '../lib/productGrouping'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'

function ChosenRow({ card, index, total, busy, onMove, onRemove }) {
  return (
    <li className="bg-white border border-black/10 rounded-xl p-3 flex flex-wrap gap-3 items-center">
      <div className="w-[64px] h-[80px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
        {card.image ? (
          <img src={card.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <Star size={18} className="text-black/20" />
        )}
      </div>
      <div className="flex-1 min-w-[180px]">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-black/45">#{index + 1}</p>
        <p className="text-[15px] font-medium leading-snug">{card.title}</p>
        <p className="text-[13px] text-black/50">
          {Array.isArray(card.colors) && card.colors.length > 1
            ? `${card.colors.length} colours`
            : 'Single colour'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0 || busy}
          aria-label={`Move ${card.title} up`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1 || busy}
          aria-label={`Move ${card.title} down`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/60 hover:border-black transition disabled:opacity-35"
        >
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${card.title} from best sellers`}
          className="w-[38px] h-[38px] grid place-items-center rounded-lg border border-black/25 text-black/50 hover:text-red-600 hover:border-red-300 transition disabled:opacity-35"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  )
}

export default function BestsellerPanel({ notify, products = [] }) {
  const [state, setState] = useState({ loading: true, picks: [], error: '' })
  const [original, setOriginal] = useState([])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  // Every design the store actually sells, built by the same rule the
  // storefront uses, so the picker and the homepage can never disagree.
  const cards = useMemo(() => groupedCards(products), [products])
  // THE one resolution rule for this panel. A pick and the list on screen are
  // not the same thing, and assuming they were is what made the old reorder
  // arrows move the wrong row:
  //
  //   * a pick may name the card OR any colour row of a grouped design (a
  //     card's id is the id of its cheapest row, and the owner may have
  //     promoted a different one);
  //   * two picks may resolve to the same card, which then shows once;
  //   * a pick whose whole design is hidden, or deleted while this panel was
  //     open, resolves to nothing and does not render — yet it is still in
  //     `state.picks`.
  //
  // So `resolved` records, for every entry that renders, where it lives in
  // `state.picks`. Everything on screen reads from it, and nothing indexes
  // `state.picks` with a position read off the rendered list.
  //
  // The id rule itself deliberately mirrors bestsellerRules'
  // `resolveBestsellers`, so this panel and the homepage agree on which picks
  // are live — matching only `card.id` used to hide a promotion that was
  // already showing on the homepage, while still offering its design as a
  // candidate (inviting the owner to add it twice).
  const resolved = useMemo(() => locatePicks(state.picks, cards), [cards, state.picks])

  const chosen = useMemo(() => resolved.map((entry) => entry.card), [resolved])

  const chosenIds = useMemo(() => new Set(chosen.map((c) => c.id)), [chosen])

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cards.filter((c) => !chosenIds.has(c.id) && (!q || String(c.title || '').toLowerCase().includes(q)))
  }, [cards, chosenIds, search])

  // A design is visible if ANY of its colours is live — the card spreads its
  // lead row, so `card.is_active` alone would misreport a design where one
  // colour was hidden and another was not.
  const availability = (card) => {
    const colors = Array.isArray(card.colors) && card.colors.length ? card.colors : [card]
    const live = colors.filter((c) => c.is_active !== false).length
    if (live === colors.length) return { label: 'Live', hidden: false }
    if (!live) return { label: 'Hidden', hidden: true }
    return { label: `Live · ${colors.length - live} hidden colour${colors.length - live === 1 ? '' : 's'}`, hidden: false }
  }

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const rows = await fetchBestsellers({ strict: true })
      const ids = rows.map((r) => r.product_id)
      setState({ loading: false, picks: ids, error: '' })
      setOriginal(ids)
    } catch (e) {
      // Reported, never mistaken for "nothing chosen" — otherwise the admin
      // could save an empty list over picks this panel never saw.
      setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load the best sellers.' }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = (card) => {
    if (state.picks.length >= MAX_BESTSELLERS) {
      notify('error', `Choose at most ${MAX_BESTSELLERS} best sellers.`)
      return
    }
    setState((s) => ({ ...s, picks: [...s.picks, card.id] }))
  }
  // Removing drops EVERY pick that renders as this card, so it cannot survive a
  // stored duplicate or a pick recorded under one of its colour rows.
  const remove = (cardId) => setState((s) => {
    // Resolved from `s.picks`, not from the render-time memo: two quick clicks
    // must never act on positions computed before the first one landed.
    const drop = new Set(locatePicks(s.picks, cards)
      .filter((entry) => entry.cardId === cardId)
      .map((entry) => entry.pick))
    if (!drop.size) return s
    return { ...s, picks: s.picks.filter((p) => !drop.has(p)) }
  })

  // Swap the two entries the arrows actually sit between, at their real
  // positions in `state.picks`. Anything in between that does not render keeps
  // its place, and a pick that resolves to nothing can no longer shift the row
  // the owner meant to move.
  const move = (cardId, dir) => setState((s) => {
    const shown = locatePicks(s.picks, cards)
    const at = shown.findIndex((entry) => entry.cardId === cardId)
    const to = at + dir
    if (at < 0 || to < 0 || to >= shown.length) return s
    const next = [...s.picks]
    const a = shown[at].index
    const b = shown[to].index
    const tmp = next[a]
    next[a] = next[b]
    next[b] = tmp
    return { ...s, picks: next }
  })

  const save = async () => {
    setSaving(true)
    try {
      await saveBestsellers(state.picks)
      await load()
      notify('success', state.picks.length
        ? 'Best sellers saved — the homepage row now shows your selection.'
        : 'Best sellers cleared — the homepage picks its own row from the catalogue again.')
    } catch (e) {
      notify('error', e?.message || 'Could not save the best sellers.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const dirty = state.picks.join('\u0000') !== original.join('\u0000')

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Best sellers</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            The designs shown in the homepage “Best Sellers” row, in order. With nothing chosen, the homepage
            selects a varied row from the catalogue by itself.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || state.loading || !dirty}
          className="inline-flex items-center gap-2 h-[46px] px-5 rounded-lg bg-brand-green text-white text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save best sellers'}
        </button>
      </div>

      {(state.error || (!state.loading && !state.picks.length)) && (
        <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">
            {state.error
              ? state.error
              : `No best sellers chosen yet — the homepage is choosing its own row. Add ${state.picks.length === 0 ? 'a design' : 'more designs'} below to take over.`}
          </span>
        </div>
      )}

      {state.loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl p-3 flex items-center gap-3 animate-pulse">
              <div className="w-[64px] h-[80px] rounded-lg bg-neutral-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-neutral-200 rounded w-1/3" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <h2 className="mt-8 text-[18px] font-bold">On the homepage ({chosen.length}/{MAX_BESTSELLERS})</h2>
          <ul className="mt-3 space-y-3">
            {chosen.map((card, i) => (
              <ChosenRow
                key={card.id}
                card={card}
                index={i}
                total={chosen.length}
                busy={saving}
                onMove={(dir) => move(card.id, dir)}
                onRemove={() => remove(card.id)}
              />
            ))}
          </ul>
          {!chosen.length && (
            <p className="mt-3 text-[14px] text-black/45">Nothing chosen — the homepage row is auto-selected.</p>
          )}

          <h2 className="mt-10 text-[18px] font-bold">Add a design</h2>
          <div className="relative mt-3 max-w-[380px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your catalogue…"
              aria-label="Search designs to add"
              className={`${inputCls} pl-9`}
            />
          </div>
          <ul className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {candidates.slice(0, 24).map((card) => (
              <li key={card.id} className="bg-white border border-black/10 rounded-xl p-3 flex gap-3 items-center">
                <div className="w-[52px] h-[64px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
                  {card.image
                    ? <img src={card.image} alt="" className="w-full h-full object-cover" />
                    : <Star size={16} className="text-black/20" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium leading-snug truncate">{card.title}</p>
                  <p className={`text-[12px] inline-flex items-center gap-1 ${availability(card).hidden ? 'text-black/40' : 'text-emerald-700'}`}>
                    {availability(card).hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    {availability(card).label}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => add(card)}
                  disabled={saving || state.picks.length >= MAX_BESTSELLERS}
                  className="shrink-0 text-[13px] font-medium border border-black/60 rounded-lg px-3 h-[36px] hover:bg-black hover:text-white transition disabled:opacity-50"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          {!candidates.length && (
            <p className="mt-3 text-[14px] text-black/45">
              {search ? 'No designs match that search.' : 'Every design is already on the list.'}
            </p>
          )}
        </>
      )}

      <p className="mt-8 text-[14px] text-black/45">
        Best sellers are product ids and a display order — nothing else. No sales figures are calculated, and a
        design that is deleted or hidden simply stops appearing.
      </p>
    </div>
  )
}
