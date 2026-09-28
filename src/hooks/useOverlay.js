import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

// Shared behaviour for modal overlays (cart drawer, mobile menu):
//  - Escape closes the overlay
//  - the page behind it cannot scroll
//  - focus moves into the panel on open and returns to whatever opened it on close
// `containerRef` must point at the panel element itself.
export default function useOverlay(open, onClose, containerRef) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const opener = useRef(null)
  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    const panel = containerRef.current
    const first = panel && panel.querySelector(FOCUSABLE)
    ;(first || panel)?.focus?.()
    return () => {
      const el = opener.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open, containerRef])
}
