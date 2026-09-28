import { useEffect } from 'react'
export default function usePageTitle(title) {
  useEffect(() => { document.title = title ? `${title} — Rohi Collection` : "Rohi Collection — Men's & Women's Fashion" }, [title])
}
