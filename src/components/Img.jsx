import { useState } from 'react'
import { imageSrcSet } from '../lib/imageSrcSet'
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
  // A smaller copy only exists for the photographs that were copied when the
  // site was built. If the browser picks one that is not there, the picture is
  // retried from the original, so a photograph is never lost because of an
  // optimisation; only if the original fails too does the neutral placeholder
  // appear.
  const srcSet = sizes && !original ? imageSrcSet(src) : undefined
  return (
    <img
      src={src}
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
