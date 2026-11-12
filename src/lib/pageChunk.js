// A page whose code is split into its own file and fetched on demand, with
// three things React.lazy alone does not do:
//
// 1. Fetch it ahead. `prefetch()` starts the download as soon as a shopper
//    shows intent, so tapping through later finds the code already here.
//    Every caller shares one download, however often it is called.
// 2. No "Loading…" flash once it is here. React.lazy suspends on its first
//    render even when the import has already finished, because a promise only
//    ever answers later. A page that has arrived is handed over synchronously
//    instead: React.lazy accepts any thenable, and one that answers at once
//    renders without suspending.
// 3. Survive a dropped connection. A failed download is tried once more, and
//    if that fails too the page renders `fallback` (an offer to reload)
//    instead of breaking the app. React.lazy remembers a failure for good,
//    which is why the retry happens here, before React sees it. A failed
//    prefetch is forgotten, so the visit itself starts afresh.
//
// Vite reports a failed dynamic import as a `vite:preloadError` event on
// `window` and then rethrows the error, unless a listener calls
// `preventDefault()`, in which case the import resolves to nothing
// (vite.dev/guide/build, "Load Error Handling"). Nothing in this app prevents
// it; a module that arrives without a page counts as a failure all the same.
//
// No imports and no Vite-only syntax, so tests can run it as it is.

export const RETRY_DELAY_MS = 1000

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function pageChunk(importer, { retryDelayMs = RETRY_DELAY_MS, wait = pause } = {}) {
  let loaded = null
  let pending = null

  const attempt = () =>
    new Promise((resolve) => resolve(importer())).then((mod) => {
      if (!mod || mod.default == null) throw new Error('The page arrived without its code.')
      return mod
    })

  /** The page's module: one download shared by every caller, retried once. */
  const load = () => {
    if (loaded) return Promise.resolve(loaded)
    if (!pending) {
      pending = attempt()
        .catch(() => wait(retryDelayMs).then(attempt))
        .then(
          (mod) => { loaded = mod; return mod },
          (error) => { pending = null; throw error },
        )
    }
    return pending
  }

  return {
    load,
    /** Start the download now. Safe to call any number of times. */
    prefetch() {
      load().catch(() => { /* the visit itself tries again */ })
    },
    /** The `load` function for React.lazy, with `fallback` as the page that cannot arrive. */
    lazy(fallback) {
      return () => {
        if (loaded) return { then: (resolve) => resolve(loaded) }
        return load().catch((error) => {
          console.error('Page code failed to load:', error)
          return { default: fallback }
        })
      }
    },
  }
}

/**
 * Run `task` once the page has finished loading and the browser is idle, so
 * a prefetch never competes with what the shopper is looking at. Returns a
 * function that cancels it. Safari has no requestIdleCallback; a short timer
 * after `load` stands in.
 */
export function whenIdle(task, { timeout = 2000 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  let cancelled = false
  let idle = null
  let timer = null
  const run = () => { if (!cancelled) task() }
  const schedule = () => {
    if (cancelled) return
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout })
    else timer = setTimeout(run, 200)
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    cancelled = true
    window.removeEventListener('load', schedule)
    if (idle != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle)
    if (timer != null) clearTimeout(timer)
  }
}
