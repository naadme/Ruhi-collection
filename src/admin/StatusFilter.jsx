// The All / Active / Inactive switch the banner, best seller and category
// photo panels share.
//
// It is a plain segmented control in the same shape as the products panel's
// own tab bar, so it looks like part of the dashboard rather than a new
// idea. The counts beside each name say what each filter would show — an
// owner who has switched everything off can see that at a glance instead of
// wondering whether the panel is broken.

import { STATUS_FILTERS } from '../lib/statusFilter.js'

export default function StatusFilter({ value, onChange, counts = {}, label = 'Show', id = 'status-filter' }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-semibold uppercase tracking-wider text-black/45">{label}</span>
      <div
        role="group"
        aria-label={label}
        id={id}
        className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1 w-fit"
      >
        {STATUS_FILTERS.map((f) => {
          const on = value === f.value
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(f.value)}
              className={`px-3.5 h-9 rounded-lg text-[14px] font-medium transition ${
                on ? 'bg-black text-white' : 'text-black/60 hover:text-black'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-[12px] ${on ? 'text-white/70' : 'text-black/40'}`}>
                {counts[f.value] ?? 0}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
