// The reads index.html started before the app's code arrived
// (src/boot/earlyStart.js): the catalogue, the categories, the published star
// ratings and, on the homepage, the hero banners.
//
// Each one is handed out ONCE, to the first read of its kind, which uses it
// instead of asking the database again. Every later read (a refresh after a
// sign-in, the dashboard's re-reads, a "Try again") goes to the database as
// before. When the page did not start a read — the dashboard, a signed-in
// visitor, the dev server, a browser that blocked it — this returns null and
// the app reads as it always has.

/** The started read called `name` (a promise of the rows), or null. */
export function takeEarly(name, win = typeof window === 'undefined' ? undefined : window) {
  const box = win && win.__ruhiEarly
  if (!box || !box[name] || typeof box[name].then !== 'function') return null
  const read = box[name]
  box[name] = null
  return read
}

/**
 * The rows of a started read, or `undefined` when there was none or it
 * failed — the caller then makes its own read. Never throws.
 */
export async function earlyRows(name, win) {
  const read = takeEarly(name, win)
  if (!read) return undefined
  try {
    const rows = await read
    return Array.isArray(rows) ? rows : undefined
  } catch {
    return undefined
  }
}
