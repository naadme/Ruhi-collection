// The Google Sheets panel in Admin → Orders.
//
// The owner connects their OWN Google account once — no service-account key,
// no JSON file, no sharing a spreadsheet with a robot — and from then on the
// orders on screen can be sent to a spreadsheet in their own Drive.
//
// Everything the browser sends is a name and a list of order ids; everything
// private (the client secret, the refresh token) never leaves the Edge
// Function. This component only ever shows what the server tells it.

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Link2, Plus, RefreshCw, Sheet, Unlink } from 'lucide-react'
import { sheetsAction } from '../lib/googleSheets'

const inputCls =
  'h-[42px] rounded-lg border border-black/30 px-3 text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'
const btnCls =
  'inline-flex items-center gap-2 h-[42px] px-4 rounded-lg border border-black/60 text-[14px] font-medium hover:bg-black hover:text-white transition disabled:opacity-55'

export default function GoogleSheetsPanel({ rows, filters, notify }) {
  // `status` is what the server knows: connected, who, and which spreadsheet.
  const [state, setState] = useState({
    status: null, busy: '', error: '', setup: null, setupLinks: null, url: '',
  })
  const [sheetName, setSheetName] = useState('')
  const [sheetLink, setSheetLink] = useState('')
  const [includeExported, setIncludeExported] = useState(false)

  const load = useCallback(async () => {
    try {
      const status = await sheetsAction('status')
      setState((s) => ({
        ...s,
        status,
        error: '',
        setup: status?.setup ?? null,
        setupLinks: status?.setupLinks ?? null,
      }))
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e?.message || 'Could not read the Google Sheets status.',
        setup: e?.setup ?? null,
        setupLinks: e?.setupLinks ?? null,
      }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The owner comes back from Google's consent screen in a new tab, so the
  // status is re-read whenever this tab is shown again.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const status = state.status
  const connected = status?.connected === true
  const sheets = Array.isArray(status?.sheets) ? status.sheets : []
  const destination = status?.spreadsheet || null
  const busy = state.busy

  // ---- connect ------------------------------------------------------------
  const connect = async () => {
    setState((s) => ({ ...s, busy: 'connect', error: '', setup: null }))
    try {
      const { authorizeUrl } = await sheetsAction('start')
      // The browser leaves for Google's consent screen and comes back to the
      // function's callback, which stores the connection.
      window.location.assign(authorizeUrl)
    } catch (e) {
      setState((s) => ({
        ...s,
        busy: '',
        error: e?.message || 'Could not start the Google sign-in.',
        setup: e?.setup ?? null,
        setupLinks: e?.setupLinks ?? null,
      }))
    }
  }

  const disconnect = async () => {
    setState((s) => ({ ...s, busy: 'disconnect', error: '', setup: null }))
    try {
      await sheetsAction('disconnect')
      setState((s) => ({ ...s, busy: '', status: { connected: false, sheets: [] } }))
      notify('success', 'Google Sheets disconnected.')
    } catch (e) {
      setState((s) => ({ ...s, busy: '', error: e?.message || 'Could not disconnect.' }))
      notify('error', e?.message || 'Could not disconnect.')
    }
  }

  // ---- the destination spreadsheet ----------------------------------------
  const createSheet = async () => {
    setState((s) => ({ ...s, busy: 'create', error: '', setup: null }))
    try {
      const result = await sheetsAction('create-sheet', { name: sheetName })
      setSheetName('')
      await load()
      notify('success', `Created “${result.spreadsheet?.title}”. Orders will go there from now on.`)
    } catch (e) {
      setState((s) => ({ ...s, busy: '', error: e?.message || 'Could not create the spreadsheet.', setup: e?.setup ?? null }))
      notify('error', e?.message || 'Could not create the spreadsheet.')
    }
  }

  const selectSheet = async (spreadsheetId) => {
    if (!spreadsheetId) return
    setState((s) => ({ ...s, busy: 'select', error: '', setup: null }))
    try {
      await sheetsAction('select-sheet', { spreadsheetId })
      await load()
      notify('success', 'Destination spreadsheet updated.')
    } catch (e) {
      setState((s) => ({ ...s, busy: '', error: e?.message || 'Could not use that spreadsheet.', setup: e?.setup ?? null }))
      notify('error', e?.message || 'Could not use that spreadsheet.')
    }
  }

  const useLink = async () => {
    if (!sheetLink.trim()) return
    await selectSheet(sheetLink.trim())
    setSheetLink('')
  }

  // ---- the export ---------------------------------------------------------
  const exportToSheets = async () => {
    if (busy || !rows.length) return
    setState((s) => ({ ...s, busy: 'export', error: '', setup: null, url: '' }))
    try {
      const result = await sheetsAction('export', {
        ids: rows.map((o) => o.id),
        filters,
        includeExported,
      })
      setState((s) => ({ ...s, busy: '', url: result.url || '' }))
      const skipped = Number(result.skipped || 0)
      notify(
        'success',
        result.orders
          ? `Sent ${result.orders} ${result.orders === 1 ? 'order' : 'orders'} to Google Sheets`
            + `${skipped ? ` (${skipped} already there, skipped)` : ''}.`
          : (result.message || 'There was nothing new to send.'),
      )
    } catch (e) {
      setState((s) => ({ ...s, busy: '', error: e?.message || 'The export failed.', setup: e?.setup ?? null }))
      notify('error', e?.message || 'The export failed.')
    }
  }

  // ---- what to draw -------------------------------------------------------
  return (
    <section className="mt-6 border border-black/10 bg-white rounded-xl p-4" aria-label="Google Sheets">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold flex items-center gap-2">
            <Sheet size={17} aria-hidden="true" /> Google Sheets
          </h2>
          <p className="text-[13px] text-black/55 mt-1">
            {connected
              ? <>Connected to <strong className="text-black/75">{status?.email || 'your Google account'}</strong>.</>
              : 'Not connected. Sign in with your own Google account to send orders to a spreadsheet.'}
          </p>
        </div>

        {connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={load} disabled={!!busy} className={btnCls} title="Refresh the connection">
              <RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={disconnect} disabled={!!busy} className={btnCls}>
              <Unlink size={15} /> Disconnect
            </button>
          </div>
        ) : (
          <button onClick={connect} disabled={!!busy} className={btnCls}>
            {busy === 'connect' ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google Sheets'}
          </button>
        )}
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      {state.setup && (
        <div role="alert" className="mt-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg px-3 py-2.5">
          <p className="text-[13px] font-semibold">Google Sheets is not ready yet</p>
          <ul className="mt-1.5 space-y-1 list-disc pl-5 text-[13px]">
            {state.setup.map((step) => <li key={step}>{step}</li>)}
          </ul>
          {Array.isArray(state.setupLinks) && state.setupLinks.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {state.setupLinks.map((link) => (
                <p key={link.url + link.label} className="text-[13px]">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline underline-offset-2"
                  >
                    {link.label}
                  </a>
                  {link.hint ? <span className="text-amber-800/80"> — {link.hint}</span> : null}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {connected && (
        <div className="mt-4 space-y-3">
          {/* ---- where the orders go ---- */}
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] items-end">
            <label className="block min-w-0">
              <span className="block text-[12px] font-medium text-black/55 mb-1">Destination spreadsheet</span>
              <select
                value={destination?.id || ''}
                onChange={(e) => selectSheet(e.target.value)}
                disabled={!!busy}
                className={`${inputCls} w-full`}
              >
                <option value="">Choose a spreadsheet…</option>
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}{s.id === destination?.id ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={exportToSheets}
              disabled={!!busy || !destination || rows.length === 0}
              className="inline-flex items-center gap-2 h-[42px] px-4 rounded-lg bg-brand-green text-white text-[14px] font-semibold hover:bg-[#A86B5C] transition disabled:opacity-55"
            >
              {busy === 'export' ? <Loader2 size={15} className="animate-spin" /> : <Sheet size={15} />}
              {busy === 'export' ? 'Sending…' : 'Export to Google Sheets'}
            </button>
          </div>

          {/* ---- create one, or use a link ---- */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="New spreadsheet name (optional)"
              aria-label="Name for a new spreadsheet"
              disabled={!!busy}
              className={`${inputCls} flex-1 min-w-[220px]`}
            />
            <button onClick={createSheet} disabled={!!busy} className={btnCls}>
              {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create spreadsheet
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={sheetLink}
              onChange={(e) => setSheetLink(e.target.value)}
              placeholder="…or paste the link of a spreadsheet you already use"
              aria-label="Link of an existing spreadsheet"
              disabled={!!busy}
              className={`${inputCls} flex-1 min-w-[220px]`}
            />
            <button onClick={useLink} disabled={!!busy || !sheetLink.trim()} className={btnCls}>Use this spreadsheet</button>
          </div>

          {/* ---- duplicates ---- */}
          <label className="flex items-center gap-2 text-[13px] text-black/65">
            <input
              type="checkbox"
              checked={includeExported}
              onChange={(e) => setIncludeExported(e.target.checked)}
              disabled={!!busy}
              className="h-4 w-4"
            />
            Send orders that are already in this spreadsheet again
          </label>

          {destination && (
            <p className="text-[12px] text-black/50">
              Orders will be appended to{' '}
              <a
                href={`https://docs.google.com/spreadsheets/d/${destination.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 inline-flex items-center gap-1"
              >
                {destination.title || 'the selected spreadsheet'} <ExternalLink size={12} aria-hidden="true" />
              </a>
              . Orders already there are skipped unless you tick the box above.
            </p>
          )}

          {state.url && (
            <p className="text-[13px] text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Sent.{' '}
              <a href={state.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-medium">
                Open the sheet
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
