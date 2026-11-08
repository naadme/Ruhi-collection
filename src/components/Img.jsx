import { useState } from 'react'
import { imageCopy } from '../lib/imageSrcSet'
// Image with a quiet neutral fallback if a remote photo fails to load.
export default function Img({ src, alt = '', className = '', sizes = '', ...rest }) {
  const [bad, setBad] = useState(false)
  const [original, setOriginal] = useState(false)
  // `src` can be absent when an owner saves a product without a photo; an
  // <img> with no source renders the browser's broken-image glyph.
  if (!src || bad) return <div role="img" aria-label={alt} className={`${className} bg-neutral-200`} />
  // When the caller says how wide the photo is shown, the browser is offered
  // the smaller copy as well — the same photograph, a fraction of the bytes.
  //
  // Smaller copies come from the photographs copied when the site was built,
  // or from Supabase's resizing for uploaded photos. If the browser's pick
  // fails to load (a missing copy, or the resizing service refusing), the
  // picture is retried from the original, so a photograph is never lost
  // because of an optimisation; only if the original fails too does the
  // neutral placeholder appear.
  const copy = sizes ? imageCopy(src) : null
  const srcSet = copy && !original ? copy.srcset : undefined
  // The picture's own `src` is the *smaller* copy while one is offered, and
  // not the original: a browser fetches `src` before it reads the `srcset`,
  // so naming the original there means every phone downloads the full-size
  // photograph and then downloads the smaller one as well. The original is
  // still offered in the `srcset` for a screen that really needs it.
  const shown = copy && !original ? copy.small : src
  return (
    <img
      src={shown}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      onError={() => {
        if (srcSet && !original) setOriginal(true)
        else setBad(true)
      }}
      loading="lazy"
      {...rest}
    />
  )
}
