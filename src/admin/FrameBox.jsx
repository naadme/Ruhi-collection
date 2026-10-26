import { useCallback, useEffect, useRef, useState } from 'react'
import { bannerPositionStyle, focusAfterDrag, focusAfterNudge } from '../lib/bannerPosition'

/**
 * One preview of an image at the shape the page really draws it.
 *
 * This is the admin half of `src/lib/bannerPosition.js`, extracted from the
 * homepage banner panel so that EVERY image editor in the portal — banners,
 * page images, product photographs, category tiles — drags one control rather
 * than growing its own. The storefront draws with the very same
 * `bannerPositionStyle`, so what is moved here is exactly what a shopper
 * sees; there is no second implementation that could drift.
 *
 * `ratio` is the shape to draw, and it has to be the shape the PAGE really
 * uses rather than a convenient rectangle: a preview wider than the real frame
 * shows the owner a slice of her photograph she will never see, and hides the
 * top and bottom she will. The banner panel passes the hero's own two shapes
 * (720/684 wide, 390/380 phone); each caller passes its own.
 *
 * Dragging moves the PHOTOGRAPH under a fixed frame — the way a print is
 * moved under a mount — which is why the frame never grows and the uploaded
 * file is never touched.
 */

export default function FrameBox({ src, label, framing, boxWidth, ratio, onDrag, onKey }) {
  const boxRef = useRef(null)
  const dragRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // The photograph's own dimensions, learned when it loads. The pan is
  // measured against how much of it falls OUTSIDE the frame, so a tall
  // photograph in a wide frame has to travel further than a wide one that
  // almost fits.
  const [natural, setNatural] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (rect) setBox((b) => (b.w === rect.width && b.h === rect.height ? b : { w: rect.width, h: rect.height }))
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const start = (e) => {
    if (!src) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // The framing is captured at the moment the finger goes down, so dragging
    // is measured against one fixed point however many events arrive.
    dragRef.current = { x: e.clientX, y: e.clientY, framing }
  }

  const move = (e) => {
    const from = dragRef.current
    if (!from) return
    onDrag(focusAfterDrag(from.framing, { dx: e.clientX - from.x, dy: e.clientY - from.y }, {
      naturalWidth: natural.w, naturalHeight: natural.h, boxWidth: box.w, boxHeight: box.h,
    }))
  }

  const stop = (e) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const nudge = (e) => {
    // Arrow keys do what a drag does, for anyone who does not use a pointer.
    const step = e.shiftKey ? 10 : 1
    const arrows = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const by = arrows[e.key]
    if (!by) return
    e.preventDefault()
    onKey(focusAfterNudge(framing, by[0], by[1]))
  }

  return (
    <figure className="shrink-0">
      <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-black/45 mb-1">{label}</figcaption>
      <div
        ref={boxRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={nudge}
        tabIndex={src ? 0 : -1}
        role={src ? 'img' : undefined}
        aria-label={src ? `${label} preview — drag to move the photograph, or use the arrow keys. Horizontal ${Math.round(framing.x)} per cent, vertical ${Math.round(framing.y)} per cent.` : undefined}
        className={`relative overflow-hidden rounded-lg border border-black/15 bg-neutral-100 touch-none select-none ${src ? 'cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-black/40' : ''}`}
        style={{ width: boxWidth, aspectRatio: ratio }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable="false"
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute inset-0 w-full h-full object-cover"
            style={bannerPositionStyle(framing)}
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[11px] text-black/35">No image</span>
        )}
      </div>
    </figure>
  )
}
