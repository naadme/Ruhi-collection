// Category management for the admin — the surface for adding, renaming and
// deleting the categories the whole storefront lists.
//
// It used to be a 13px underlined text link that opened a panel INSIDE the
// product editor's <form>. Two things were wrong with that:
//
//   1. it was easy to miss, so "Add Category" looked broken even when it
//      worked, and
//   2. the panel carried its own <form>, and a <form> inside a <form> shares
//      the submit path — pressing Enter, or clicking the panel's submit
//      button, also ran the product editor's own submit and saved (or refused
//      to save) the product the owner was part-way through editing.
//
// The panel is therefore a MODAL, portalled straight to document.body so it
// is not a descendant of the product form at all: the two submit paths can no
// longer meet, and the category controls get a full, readable layout.
//
// Design rules, all of them enforced in src/lib/categories.js and, for the
// last one, by the database itself (`products_type_fkey`, ON DELETE RESTRICT):
//
//  * The client types a NAME. The key ("trousers") is derived from it, so a
//    slug is never something they have to think about.
//  * Duplicates are refused before any write: two names that differ only by
//    case or surrounding spaces are the same category.
//  * RENAMING changes the label only — the key, and therefore every product's
//    `type`, is untouched, so a rename can never detach a product.
//  * DELETING is refused while any product still uses the category. The count
//    shown is what the refusal is based on, and the database refuses the same
//    delete independently if the count is stale.
//
// Product managers can PICK a category but not create or rename or delete
// one: `categories` writes are gated on is_admin(), so the UI hides what the
// database would refuse.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { categoryUsage, createCategory, deleteCategory, renameCategory } from '../lib/categories'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[42px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'
const btnCls =
  'inline-flex items-center gap-1.5 text-[13px] font-medium border border-black/60 rounded-lg px-3 h-[40px] hover:bg-black hover:text-white transition disabled:opacity-55'

export default function CategoryManager({ categories, onSaved }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')          // '' | 'add' | key being edited
  const [note, setNote] = useState(null)        // { kind: 'ok' | 'err', text }
  const [usage, setUsage] = useState(null)      // Map(key -> product count)
  const [renaming, setRenaming] = useState('')  // key whose label is being edited
  const [draft, setDraft] = useState('')
  const [armed, setArmed] = useState('')        // key awaiting a second click
  const nameInput = useRef(null)

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await categoryUsage())
    } catch {
      setUsage(null) // unknown counts must never look like "0 in use"
    }
  }, [])

  useEffect(() => {
    if (open) loadUsage()
  }, [open, loadUsage])

  // A modal the owner cannot dismiss with Escape or the backdrop would be a
  // trap, so both close it — and focus lands in the name box, which is the one
  // thing the panel is opened for.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => nameInput.current?.focus(), 0)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open])

  const close = () => {
    setOpen(false)
    setNote(null)
    setArmed('')
    setRenaming('')
    setLabel('')
    setBusy('')
  }

  const fail = (e) => setNote({ kind: 'err', text: e?.message || 'Something went wrong. Please try again.' })
  const done = (text) => setNote({ kind: 'ok', text })

  const add = async (e) => {
    // Both: the modal is portalled outside the product form, but preventing
    // the default and stopping propagation keeps a stray Enter from ever
    // reaching any other form on the page.
    e?.preventDefault?.()
    e?.stopPropagation?.()
    setNote(null)
    setBusy('add')
    try {
      const row = await createCategory(label)
      setLabel('')
      done(`“${row.label}” added — it is already selectable for this product.`)
      await onSaved?.(row)
      loadUsage()
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const rename = async (key) => {
    setNote(null)
    setBusy(key)
    try {
      const next = await renameCategory(key, draft)
      setRenaming('')
      done(`Renamed to “${next}”. Products keep their category — only the name shoppers see changed.`)
      await onSaved?.()
      loadUsage()
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const remove = async (c) => {
    if (armed !== c.key) {
      setArmed(c.key)
      setNote({ kind: 'ok', text: `Click delete again to remove “${c.label}”.` })
      return
    }
    setArmed('')
    setNote(null)
    setBusy(c.key)
    try {
      await deleteCategory(c.key, usage)
      done(`“${c.label}” deleted.`)
      await onSaved?.()
      loadUsage()
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  // Nothing may be deleted on a guess. Until the real counts are known — or
  // if the read that fetches them failed — every Delete stays disabled rather
  // than appearing to work and then being refused by the database.
  const countsKnown = usage !== null

  const trigger = (
    <button
      type="button"
      onClick={() => { setOpen(true); setNote(null); setArmed(''); setRenaming('') }}
      className="mt-2 inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg border border-black/60 text-[13px] font-medium hover:bg-black hover:text-white transition"
    >
      <Plus size={14} aria-hidden="true" /> Add category
    </button>
  )

  const panel = open ? createPortal(
    <div className="fixed inset-0 z-[60] font-ui">
      <div className="absolute inset-0 bg-black/40" onMouseDown={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage categories"
        className="relative mx-auto my-8 w-[min(560px,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto bg-white rounded-2xl border border-black/10 p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold">Categories</h2>
            <p className="text-[13px] text-black/55 mt-1">
              These are the categories shoppers filter and search by. Adding one makes it selectable here straight away.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close category management"
            className="w-9 h-9 grid place-items-center rounded-full border border-black/15 hover:bg-black hover:text-white transition shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* ---- create ---- */}
        <form onSubmit={add} onClick={(e) => e.stopPropagation()} className="flex flex-wrap gap-2 items-center">
          <input
            ref={nameInput}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="New category name, e.g. Kurtis"
            aria-label="New category name"
            className={`${inputCls} flex-1 min-w-[200px]`}
          />
          <button type="submit" disabled={busy === 'add' || !label.trim()} className={btnCls}>
            {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
          <button type="button" onClick={close} className={btnCls}>
            <X size={14} aria-hidden="true" /> Cancel
          </button>
        </form>

        {note && (
          <p
            role={note.kind === 'err' ? 'alert' : 'status'}
            className={`text-[13px] ${note.kind === 'err' ? 'text-red-600' : 'text-green-700'}`}
          >
            {note.text}
          </p>
        )}

        {/* ---- existing ---- */}
        <ul className="divide-y divide-black/10 border-t border-black/10">
          {categories.map((c) => {
            const n = usage ? (usage.get(c.key) || 0) : null
            const inUse = Number(n) > 0
            return (
              <li key={c.key} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-[14rem]">
                  {renaming === c.key ? (
                    <div className="flex gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label={`New name for ${c.label}`}
                        className={`${inputCls} h-[38px]`}
                      />
                      <button type="button" onClick={() => rename(c.key)} disabled={busy === c.key} className={btnCls}>
                        {busy === c.key ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                      </button>
                      <button type="button" onClick={() => setRenaming('')} className={btnCls} aria-label="Cancel rename">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[15px] font-medium truncate">{c.label}</p>
                      <p className="text-[12px] text-black/45 font-mono">
                        {c.key}
                        {n === null ? '' : ` · ${n} ${n === 1 ? 'product' : 'products'}`}
                      </p>
                    </>
                  )}
                </div>
                {renaming !== c.key && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setRenaming(c.key); setDraft(c.label); setArmed(''); setNote(null) }}
                      className={btnCls}
                    >
                      <Pencil size={13} /> Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={busy === c.key || inUse || !countsKnown}
                      title={inUse
                        ? `${n} ${n === 1 ? 'product is' : 'products are'} still in this category — move them first`
                        : !countsKnown
                          ? 'Still checking how many products use each category — try again in a moment'
                          : 'Delete this category'}
                      className={`${btnCls} ${armed === c.key ? '!border-red-600 !bg-red-600 !text-white' : '!border-black/25 !text-black/50 hover:!text-red-600 hover:!border-red-300'}`}
                    >
                      {busy === c.key ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {armed === c.key ? 'Confirm delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <p className="text-[12px] text-black/45 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Renaming keeps every product where it is — only the name shoppers see changes. A category with
            products in it cannot be deleted; move those products to another category first.
            {!countsKnown && ' Product counts are unavailable right now, so nothing can be deleted until they load.'}
          </span>
        </p>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      {trigger}
      {panel}
    </>
  )
}
