// The homepage's code is its own file, fetched on demand (homepage redesign,
// 21 Nov 2026), so the product pages ads land on download less: almost every
// ad visitor lands on a product page and never sees the homepage
// (Ruhi_Speed_Framework.md, rule 4).
//
// Someone who DOES open the homepage doesn't wait for it: a few bytes in the
// page start downloading it alongside the main script (vite.config.js,
// `preloadPageChunks`), and the app asks for it the moment it starts, before
// anything is drawn (`prefetchHomeOnHome`), so it is usually here by the first
// render. Everywhere else it is fetched once the page is idle, so a tap on the
// logo opens it at once.
import { pageChunk, whenIdle } from './pageChunk'

export const homePage = pageChunk(() => import('../pages/Home'))

const onHome = () => typeof window !== 'undefined' && (window.location.pathname.replace(/\/+$/, '') || '/') === '/'

/** On the homepage: start now. Elsewhere: once the page is idle. */
export function prefetchHome() {
  if (onHome()) homePage.prefetch()
  else whenIdle(() => homePage.prefetch())
}
