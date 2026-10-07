import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const DEFAULT_TITLE = "Ruhi Womens Clothing — Co-ord Sets, Dresses & Tops"
const DEFAULT_DESCRIPTION =
  'Shop co-ord sets, dresses, tops and shirts at Ruhi Womens Clothing. Free shipping for all products, fast delivery across India.'

function upsertMeta(attr, key, content) {
  if (!content) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * Sets the document title and the share/search metadata for the current view.
 * Because this is a single-page app the crawlers only see one HTML file, so the
 * description, canonical URL and Open Graph tags are written per route here.
 *
 * @param {string} title  Page name, or '' for the home page.
 * @param {string} [description] Search-result / share description for this page.
 */
export default function usePageTitle(title, description = DEFAULT_DESCRIPTION) {
  const { pathname, search } = useLocation()

  useEffect(() => {
    const full = title ? `${title} — Ruhi Womens Clothing` : DEFAULT_TITLE
    document.title = full

    // The admin surface is private; it should never be described or linked as
    // if it were public content.
    if (pathname.startsWith('/admin')) {
      upsertCanonical(`${window.location.origin}/admin`)
      return
    }

    const url = window.location.origin + pathname + search
    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:site_name', 'Ruhi Womens Clothing')
    upsertMeta('property', 'og:title', full)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:url', url)
    upsertMeta('property', 'og:locale', 'en_IN')
    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', full)
    upsertMeta('name', 'twitter:description', description)
    upsertCanonical(url)
  }, [title, description, pathname, search])
}
