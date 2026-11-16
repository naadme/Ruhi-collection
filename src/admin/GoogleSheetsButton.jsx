// The client's "Google Sheets – Orders" button.
//
// One click opens the real spreadsheet in a new tab. When the sheet is not
// connected yet, the same click takes the owner to Orders with the one-time
// Google consent flow already started — it is never a dead link and never a
// claim that a sheet exists when it does not.

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Sheet } from 'lucide-react'
import { sheetsAction } from '../lib/googleSheets'

export default function GoogleSheetsButton() {
  const [state, setState] = useState({ loading: true, url: '', title: '' })

  useEffect(() => {
    let alive = true
    sheetsAction('status')
      .then((status) => {
        if (!alive) return
        const id = status?.spreadsheet?.id || ''
        setState({
          loading: false,
          url: id ? `https://docs.google.com/spreadsheets/d/${id}` : '',
          title: status?.spreadsheet?.title || '',
        })
      })
      .catch(() => {
        if (alive) setState({ loading: false, url: '', title: '' })
      })
    return () => { alive = false }
  }, [])

  const className =
    'inline-flex items-center gap-2 h-[46px] px-4 rounded-lg bg-brand-green text-white '
    + 'text-[15px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-60'

  if (state.loading) {
    return (
      <span className={className} aria-busy="true">
        <Loader2 size={17} className="animate-spin" /> Google Sheets – Orders
      </span>
    )
  }

  if (state.url) {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noreferrer"
        className={className}
        title={state.title ? `Open “${state.title}”` : 'Open the orders spreadsheet'}
      >
        <Sheet size={17} /> Google Sheets – Orders <ExternalLink size={14} />
      </a>
    )
  }

  return (
    <a
      href="/admin?section=orders&connect=1"
      className={className}
      title="Connect the Google account that will own the orders spreadsheet"
    >
      <Sheet size={17} /> Google Sheets – Orders
    </a>
  )
}
