import { useState } from 'react'
// Image with a quiet neutral fallback if a remote photo fails to load.
export default function Img({ src, alt = '', className = '', ...rest }) {
  const [bad, setBad] = useState(false)
  // `src` can be absent when an owner saves a product without a photo; an
  // <img> with no source renders the browser's broken-image glyph.
  if (!src || bad) return <div role="img" aria-label={alt} className={`${className} bg-neutral-200`} />
  return <img src={src} alt={alt} className={className} onError={() => setBad(true)} loading="lazy" {...rest} />
}
