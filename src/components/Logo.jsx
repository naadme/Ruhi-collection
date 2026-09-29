import { Link } from 'react-router-dom'

// The client's actual logo (public/images/ruhi-logo.jpg) replaces the previous
// two-line text lockup.
//
// The source photo shipped with a square canvas and ~54% blank margin top and
// bottom, so at any height the header can spare the mark rendered at barely
// half the width of the text it replaced. Only that empty margin was trimmed —
// the artwork itself is untouched — which restores the original footprint.
//
// The cream plate is deliberate: the mark's lettering is dark brown, which is
// unreadable against the green footer the old lockup was styled for. That is
// also why `light` — which recoloured the old text for dark backgrounds — is
// accepted but no longer does anything.
export default function Logo({ light }) {
  return (
    <Link to="/" aria-label="Ruhi Womens Clothing — home" className="leading-none shrink-0 block">
      <img
        src="/images/ruhi-logo.jpg"
        alt="Ruhi Womens Clothing"
        width={968}
        height={628}
        className="block h-16 md:h-[80px] w-auto object-contain"
      />
    </Link>
  )
}
