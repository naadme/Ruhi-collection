import { ChevronDown, ChevronRight, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { typeLabel } from '../data/products'
import { colourOf } from '../lib/productForm'

// ---------------------------------------------------------------------------
// Product list rendering for the dashboard.
//
// Products are grouped with the SAME rule the storefront uses (see
// src/lib/productGrouping.js): rows whose title carries a known colour and
// which share a category and design name are one product with colour variants.
// A product with a single row renders exactly as the dashboard always showed
// it; a product with several colours renders as one parent card that expands
// into its variants, so the owner manages a design — never a wall of near
// identical rows.
// ---------------------------------------------------------------------------

function Thumb({ src, w = 'w-14 h-16 sm:w-16 sm:h-20' }) {
  return (
    <div className={`${w} rounded-lg overflow-hidden bg-neutral-100 shrink-0`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <span className="w-full h-full grid place-items-center text-black/25">
          <Package size={20} />
        </span>
      )}
    </div>
  )
}

function StatusPill({ state, busy, onClick, label, title }) {
  // state: 'live' | 'hidden' | 'mixed'
  const tone =
    state === 'live'
      ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
      : state === 'mixed'
        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
        : 'bg-neutral-100 border-black/15 text-black/50 hover:border-black/40'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={state === 'live'}
      aria-label={label}
      title={title}
      className={`inline-flex items-center gap-2 h-9 px-3 rounded-full border text-[13px] font-medium transition disabled:opacity-60 ${tone}`}
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <span
          className={`w-2 h-2 rounded-full ${
            state === 'live' ? 'bg-green-600' : state === 'mixed' ? 'bg-amber-500' : 'bg-black/35'
          }`}
        />
      )}
      {state === 'live' ? 'Live' : state === 'mixed' ? 'Mixed' : 'Hidden'}
    </button>
  )
}

function IconBtn({ label, onClick, children, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`w-9 h-9 grid place-items-center rounded-lg border transition disabled:opacity-60 ${
        danger
          ? 'border-black/20 text-red-600 hover:bg-red-600 hover:text-white hover:border-red-600'
          : 'border-black/20 hover:bg-black hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/** A product with a single row: the dashboard row as it has always looked. */
export function ProductRow({ p, busy, onToggle, onEdit, onDelete }) {
  return (
    <li className="bg-white border border-black/10 rounded-xl p-3 sm:p-4 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 hover:border-black/25 transition">
      <Thumb src={p.image} />

      <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-auto">
        <p className="font-semibold text-[16px] leading-snug truncate">{p.title}</p>
        <p className="text-[13px] text-black/50 mt-0.5 capitalize">
          {typeLabel(p.type)} · <span className="font-mono normal-case">{p.id}</span>
        </p>
        <p className="text-[15px] mt-1 font-medium">
          <span className="text-red-600 font-bold">₹{p.price}</span>
          {p.compare ? <span className="text-black/40 text-[13px] line-through ml-2">₹{p.compare}</span> : null}
          {p.badge ? <span className="ml-2 text-[11px] font-bold bg-brand-badge text-white px-1.5 py-0.5 rounded-sm">{p.badge}</span> : null}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
        <StatusPill
          state={p.is_active ? 'live' : 'hidden'}
          busy={busy}
          onClick={onToggle}
          label={p.is_active ? `Hide ${p.title}` : `Show ${p.title}`}
          title={p.is_active ? 'Live — click to hide' : 'Hidden — click to show'}
        />
        <IconBtn label={`Edit ${p.title}`} onClick={onEdit}><Pencil size={15} /></IconBtn>
        <IconBtn label={`Delete ${p.title}`} onClick={onDelete} danger><Trash2 size={15} /></IconBtn>
      </div>
    </li>
  )
}

const priceOf = (r) => Number(r.price) || 0

/** One parent product, expandable into its colour variants. */
export function GroupCard({
  g, expanded, onExpand, busyId, onToggleGroup, onToggleVariant,
  onEdit, onEditVariant, onAddColour, onDeleteGroup, onRemoveVariant,
}) {
  const lead = g.rows[0]
  const colours = g.rows.map((r) => colourOf(r))
  const liveCount = g.rows.filter((r) => r.is_active).length
  const groupState = liveCount === g.rows.length ? 'live' : liveCount === 0 ? 'hidden' : 'mixed'
  const prices = g.rows.map(priceOf)
  const from = Math.min(...prices)
  const to = Math.max(...prices)
  const busy = (id) => busyId === id
  const groupBusy = g.rows.some((r) => busy(r.id))

  return (
    <li className="bg-white border border-black/10 rounded-xl overflow-hidden hover:border-black/25 transition">
      <div className="p-3 sm:p-4 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4">
        <Thumb src={lead.image} />

        <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-auto">
          <p className="font-semibold text-[16px] leading-snug truncate">{g.name}</p>
          <p className="text-[13px] text-black/50 mt-0.5 capitalize">
            {typeLabel(lead.type)} · {g.rows.length} colours · {liveCount} live
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {g.rows.map((r, i) => (
              <span
                key={r.id}
                title={r.is_active ? `In store: ${colours[i] || 'no colour'}` : `Hidden: ${colours[i] || 'no colour'}`}
                className={`text-[12px] font-medium px-2 py-0.5 rounded-full border ${
                  r.is_active ? 'bg-white border-black/25 text-black/70' : 'bg-neutral-100 border-black/10 text-black/35 line-through'
                }`}
              >
                {colours[i] || 'No colour'}
              </span>
            ))}
          </div>
          <p className="text-[15px] mt-1 font-medium">
            <span className="text-red-600 font-bold">
              {from === to ? `₹${from}` : `₹${from} – ₹${to}`}
            </span>
            {lead.compare ? <span className="text-black/40 text-[13px] line-through ml-2">₹{lead.compare}</span> : null}
            {lead.badge ? <span className="ml-2 text-[11px] font-bold bg-brand-badge text-white px-1.5 py-0.5 rounded-sm">{lead.badge}</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
          <StatusPill
            state={groupState}
            busy={groupBusy}
            onClick={onToggleGroup}
            label={`${groupState === 'hidden' ? 'Show' : 'Hide'} every colour of ${g.name}`}
            title={
              groupState === 'live'
                ? 'Live — click to hide every colour'
                : groupState === 'mixed'
                  ? 'Some colours are hidden — click to show them all'
                  : 'Hidden — click to show every colour'
            }
          />
          <button
            onClick={onExpand}
            aria-expanded={expanded}
            aria-label={expanded ? `Hide the colours of ${g.name}` : `Show the colours of ${g.name}`}
            className="w-9 h-9 grid place-items-center rounded-lg border border-black/20 hover:bg-black hover:text-white transition"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <IconBtn label={`Edit ${g.name}`} onClick={onEdit}><Pencil size={15} /></IconBtn>
          <IconBtn label={`Delete ${g.name}`} onClick={onDeleteGroup} danger><Trash2 size={15} /></IconBtn>
        </div>
      </div>

      {expanded && (
        <ul className="border-t border-black/10 divide-y divide-black/5 bg-[#FCFBF9]">
          {g.rows.map((r, i) => (
            <li key={r.id} className="px-3 sm:px-4 py-3 flex flex-wrap items-center gap-3">
              <Thumb src={r.image} w="w-10 h-12" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[14px] truncate">{colours[i] || 'No colour'}</p>
                <p className="text-[12px] text-black/45 font-mono truncate">{r.id}</p>
              </div>
              <p className="text-[14px] font-medium shrink-0">
                <span className="text-red-600 font-bold">₹{r.price}</span>
                {r.compare ? <span className="text-black/40 text-[12px] line-through ml-1.5">₹{r.compare}</span> : null}
              </p>
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <StatusPill
                  state={r.is_active ? 'live' : 'hidden'}
                  busy={busy(r.id)}
                  onClick={() => onToggleVariant(r)}
                  label={`${r.is_active ? 'Hide' : 'Show'} ${g.name} in ${colours[i] || 'this colour'}`}
                  title={r.is_active ? 'Live — click to hide this colour' : 'Hidden — click to show this colour'}
                />
                <IconBtn label={`Edit ${g.name} in ${colours[i] || 'this colour'}`} onClick={() => onEditVariant(r)}>
                  <Pencil size={15} />
                </IconBtn>
                <IconBtn
                  label={`Remove the ${colours[i] || ''} colour from ${g.name}`}
                  onClick={() => onRemoveVariant(r)}
                  danger
                >
                  <Trash2 size={15} />
                </IconBtn>
              </div>
            </li>
          ))}
          <li className="px-3 sm:px-4 py-3">
            <button
              onClick={onAddColour}
              className="w-full h-[42px] rounded-lg border border-dashed border-black/30 text-[14px] font-medium text-black/60 hover:border-black hover:text-black transition inline-flex items-center justify-center gap-2"
            >
              <Plus size={15} /> Add another colour
            </button>
          </li>
        </ul>
      )}
    </li>
  )
}
