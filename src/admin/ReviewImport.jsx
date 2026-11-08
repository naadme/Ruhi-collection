// Upload reviews from a sheet — the "Upload from sheet" box in Admin → Reviews.
//
// Customers send their reviews on WhatsApp, Instagram, by phone or in the
// shop. The owner puts them in a sheet, one row per review, and uploads it
// here. Three steps, and nothing reaches the site in any of them:
//
//   1. Choose the file (.xlsx or .csv). The template has the headings and a
//      Products tab with every product's link and Product ID to copy from.
//   2. Every row is checked and shown as it will be stored: ready, needs a
//      look, or cannot be added (with the reason). Rows that cannot be added
//      are left out; the rest go in together.
//   3. They land in the Reviews list as pending and unverified. The owner
//      checks each one, marks "Verified purchase" where she has checked the
//      purchase herself, and approves it. A wrong upload can be undone.
//
// The checks are in src/lib/reviewSheet.js; the database checks every row
// again (`import_reviews`, admin-only, all or nothing).

import { useState } from 'react'
import { AlertTriangle, Check, Download, FileSpreadsheet, Info, Loader2, Star, Undo2, Upload, X } from 'lucide-react'
import { readSpreadsheet } from '../lib/xlsxRead'
import { MAX_ROWS, checkSheet, importable, indiaToday, pickSheet, reviewTemplateWorkbook } from '../lib/reviewSheet'
import { importReviews, undoImport } from '../lib/reviewStore'
import { channelCopy, starLabel } from '../lib/reviews'
import { isPurchase } from '../lib/tracking'

const STATE_COPY = {
  ready: ['Ready', 'bg-green-50 text-green-800 border-green-200'],
  warn: ['Needs a look', 'bg-amber-50 text-amber-800 border-amber-200'],
  error: ['Can’t be added', 'bg-red-50 text-red-700 border-red-200'],
}

const btnCls =
  'inline-flex items-center gap-2 h-[42px] px-4 rounded-lg border text-[14px] font-semibold transition disabled:opacity-60'

/** "2026-11-03" -> "3 Nov 2026". */
const showDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
}

function downloadTemplate(products) {
  const blob = new Blob([reviewTemplateWorkbook(products)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ruhi-reviews-template.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Stars({ rating }) {
  if (!rating) return <span className="text-[13px] text-red-700">no stars</span>
  return (
    <span role="img" aria-label={starLabel(rating)} className="inline-flex items-center gap-[1px]">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} strokeWidth={0} fill={n <= rating ? '#f59e0b' : '#e5e5e5'} />
      ))}
    </span>
  )
}

/** One row of the sheet, as it will be stored, with what was found. */
function RowCard({ item }) {
  const { view, product } = item
  const [word, cls] = STATE_COPY[item.state]
  const privateBits = [
    view.phone && `mobile ${view.phone}`,
    view.orderRef && `order ${view.orderRef}`,
    view.channel && `via ${channelCopy(view.channel)}`,
    view.note && `note: ${view.note}`,
  ].filter(Boolean)
  return (
    <li className="bg-white border border-black/10 rounded-xl p-4 flex gap-4 items-start">
      <div className="w-[52px] h-[64px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
        {product?.image
          ? <img src={product.image} alt="" className="w-full h-full object-cover" />
          : <Star size={16} className="text-black/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[12px] font-mono text-black/45">Row {item.row}</span>
          <span className={`rounded-full border px-2 py-[1px] text-[11px] font-medium ${cls}`}>{word}</span>
          <Stars rating={view.rating} />
          <b className="font-ui text-[14px]">{view.label.name}</b>
          {view.label.place && <span className="text-[13px] text-black/55">{view.label.place}</span>}
          {view.date && <span className="text-[13px] text-black/45">{showDate(view.date)}</span>}
        </p>
        <p className="text-[13px] text-black/60 mt-0.5">
          {product
            ? <>for <span className="font-semibold text-black/80">{product.title || product.id}</span>
                {product.sku && <span className="font-mono text-black/45 ml-2">{product.sku}</span>}</>
            : <span className="italic">no product</span>}
          {view.size && <span> · Size {view.size}</span>}
        </p>
        {view.title && <p className="text-[14px] font-semibold mt-2">{view.title}</p>}
        {view.body && (
          <p className="text-[14px] leading-6 text-black/70 mt-1 whitespace-pre-line line-clamp-4">{view.body}</p>
        )}
        {privateBits.length > 0 && (
          <p className="text-[12px] text-black/50 mt-2">
            <span className="font-semibold">Private:</span> {privateBits.join(' · ')}
          </p>
        )}
        {(item.problems.length > 0 || item.warnings.length > 0 || item.notes.length > 0) && (
          <ul className="mt-2 space-y-1 text-[13px]">
            {item.problems.map((m) => (
              <li key={m} className="flex gap-1.5 text-red-700"><X size={14} className="shrink-0 mt-[3px]" />{m}</li>
            ))}
            {item.warnings.map((m) => (
              <li key={m} className="flex gap-1.5 text-amber-800"><AlertTriangle size={14} className="shrink-0 mt-[3px]" />{m}</li>
            ))}
            {item.notes.map((m) => (
              <li key={m} className="flex gap-1.5 text-black/55"><Info size={14} className="shrink-0 mt-[3px]" />{m}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export default function ReviewImport({ products = [], existing = [], orders = [], notify, onClose, onImported }) {
  const [phase, setPhase] = useState('pick') // pick | reading | checked | saving | done
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [checked, setChecked] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [result, setResult] = useState(null)
  const [undoing, setUndoing] = useState(false)
  const [confirmUndo, setConfirmUndo] = useState(false)

  const choose = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setFileName(file.name)
    setPhase('reading')
    try {
      const sheets = await readSpreadsheet(new Uint8Array(await file.arrayBuffer()), file.name)
      const sheet = pickSheet(sheets)
      if (!sheet) throw new Error('This file has no sheets in it.')
      setSheetName(sheets.length > 1 ? sheet.name : '')
      setChecked(checkSheet({
        rows: sheet.rows,
        products,
        existing,
        orders,
        isPaid: isPurchase,
        today: indiaToday(),
      }))
      setFilter('all')
      setPhase('checked')
    } catch (err) {
      setError(err?.message || 'This file could not be read.')
      setPhase('pick')
    }
  }

  const rows = importable(checked)
  const add = async () => {
    if (!rows.length || checked?.tooMany) return
    setPhase('saving')
    setError('')
    try {
      const saved = await importReviews(rows)
      setResult(saved)
      setPhase('done')
      notify?.('success', `${saved.count} review${saved.count === 1 ? '' : 's'} added to Pending. None is on the site yet.`)
      onImported?.()
    } catch (err) {
      setError(err?.message || 'Nothing was added. Please try again.')
      setPhase('checked')
    }
  }

  const undo = async () => {
    if (!result?.batch) return
    setUndoing(true)
    try {
      const { removed, kept } = await undoImport(result.batch)
      notify?.('success', kept
        ? `Upload undone: ${removed} removed. ${kept} already published stay on the site.`
        : `Upload undone: ${removed} review${removed === 1 ? '' : 's'} removed.`)
      onImported?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'The upload could not be undone.')
    } finally {
      setUndoing(false)
      setConfirmUndo(false)
    }
  }

  const header = checked?.header
  const shown = (checked?.rows || []).filter((r) => filter === 'all' || r.state === filter)
  const fileInput = (label, primary) => (
    <label
      className={`${btnCls} cursor-pointer ${primary
        ? 'border-black bg-black text-white hover:bg-black/85'
        : 'border-black/40 hover:bg-black hover:text-white'}`}
    >
      <Upload size={16} /> {label}
      <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={choose} className="sr-only" />
    </label>
  )

  return (
    <section className="mt-6 bg-neutral-50 border border-black/15 rounded-2xl p-4 sm:p-5" aria-labelledby="review-import-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="review-import-heading" className="text-[20px] font-bold flex items-center gap-2">
            <FileSpreadsheet size={20} /> Upload reviews from a sheet
          </h2>
          <p className="text-[14px] text-black/55 mt-1">
            For reviews customers sent you on WhatsApp, Instagram, by phone or in the shop. Nothing goes on the site
            until you approve each review.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={phase === 'saving' || undoing}
          aria-label="Close the upload"
          className="shrink-0 p-2 rounded-lg hover:bg-black/5 transition disabled:opacity-50"
        >
          <X size={18} />
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {(phase === 'pick' || phase === 'reading') && (
        <div className="mt-4">
          <ol className="list-decimal pl-5 space-y-1 text-[14px] text-black/70">
            <li>Download the template. Its Products tab lists every product’s link and Product ID to copy from.</li>
            <li>Fill one row per review. Only the product, the stars and the review are needed. Your own sheet works
              too, as long as it has those three columns.</li>
            <li>Upload it here. You will see every row before anything is saved.</li>
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => downloadTemplate(products)}
              className={`${btnCls} border-black/40 hover:bg-black hover:text-white`}
            >
              <Download size={16} /> Download template
            </button>
            {phase === 'reading'
              ? <span className="inline-flex items-center gap-2 text-[14px] text-black/60"><Loader2 size={16} className="animate-spin" /> Reading {fileName}…</span>
              : fileInput('Choose .xlsx or .csv file', true)}
          </div>
        </div>
      )}

      {(phase === 'checked' || phase === 'saving') && checked && (
        <div className="mt-4">
          <p className="text-[14px] text-black/60">
            <span className="font-semibold text-black/80">{fileName}</span>
            {sheetName && <> · sheet “{sheetName}”</>}
          </p>

          {header.missing.length > 0 ? (
            <div className="mt-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3 text-[14px]">
              This sheet has no column for: <b>{header.missing.join(', ')}</b>. Name the columns as in the template
              (e.g. “Product link or ID”, “Stars”, “Review”) and upload it again.
            </div>
          ) : checked.rows.length === 0 ? (
            <p className="mt-3 text-[14px] text-black/60">The sheet has headings but no reviews under them.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show rows">
                {[
                  ['all', `All ${checked.rows.length}`],
                  ['ready', `${checked.ready} ready`],
                  ['warn', `${checked.warned} need a look`],
                  ['error', `${checked.failed} can’t be added`],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={`px-3 h-8 rounded-lg text-[13px] font-medium border transition ${
                      filter === value ? 'bg-black text-white border-black' : 'bg-white border-black/15 text-black/65 hover:text-black'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {header.ignored.length > 0 && (
                <p className="mt-2 text-[13px] text-black/45">Columns not used: {header.ignored.join(', ')}.</p>
              )}
              {checked.tooMany && (
                <p className="mt-2 text-[14px] text-red-700">
                  Upload at most {MAX_ROWS} reviews at a time. Split the sheet and upload it in parts.
                </p>
              )}
              {checked.failed > 0 && (
                <p className="mt-2 text-[13px] text-black/55">
                  Rows that can’t be added are left out. Fix them in the sheet and upload it again later: reviews
                  already added are recognised and skipped.
                </p>
              )}

              <ul className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {shown.map((item) => <RowCard key={item.row} item={item} />)}
                {shown.length === 0 && <li className="text-[14px] text-black/55">No rows here.</li>}
              </ul>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {rows.length > 0 && !checked.tooMany && header.missing.length === 0 && (
              <button
                type="button"
                onClick={add}
                disabled={phase === 'saving'}
                className={`${btnCls} border-black bg-black text-white hover:bg-black/85`}
              >
                {phase === 'saving' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Add {rows.length} review{rows.length === 1 ? '' : 's'} to Pending
              </button>
            )}
            {phase !== 'saving' && fileInput('Choose another file', false)}
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="mt-4">
          <p className="flex items-start gap-2 text-[15px] text-green-800">
            <Check size={18} className="shrink-0 mt-0.5" />
            <span>
              {result.count} review{result.count === 1 ? '' : 's'} added to Pending. None is on the site yet. Check each
              one in the list below, mark “Verified purchase” where you have checked the purchase, and approve it.
            </span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className={`${btnCls} border-black bg-black text-white hover:bg-black/85`}
            >
              Done
            </button>
            {confirmUndo ? (
              <span className="inline-flex flex-wrap items-center gap-2 border border-red-200 bg-red-50 rounded-xl px-3 py-2 text-[13px] text-red-800">
                Remove the {result.count} reviews of this upload?
                <button
                  type="button"
                  onClick={undo}
                  disabled={undoing}
                  className="inline-flex items-center gap-1 h-[30px] px-3 rounded-lg border border-red-400 font-semibold hover:bg-red-100 transition disabled:opacity-60"
                >
                  {undoing ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Remove them
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmUndo(false)}
                  disabled={undoing}
                  className="h-[30px] px-3 rounded-lg border border-black/30 font-semibold text-black/60 hover:bg-white transition"
                >
                  Keep them
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmUndo(true)}
                className={`${btnCls} border-black/30 text-black/70 hover:bg-black hover:text-white`}
              >
                <Undo2 size={16} /> Undo this upload
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
