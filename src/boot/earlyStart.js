// Starts the page's slowest work while the app's own code is still downloading.
//
// Every page used to wait for the shop's scripts (~185 kB) to arrive and run
// before it even ASKED the database for the catalogue, and only then for the
// main photo. The database is in Seoul: each read takes 0.2–0.9 s from India,
// and on a phone connection the scripts take another 1–2 s. Lighthouse on the
// ad landing page (13 Nov 2026) found the photo starting about 1.1 s after the
// page could have asked for it.
//
// So the page itself starts, in the first milliseconds:
// - the same public reads the app makes on arrival (catalogue, categories,
//   published star ratings, and on the homepage the hero banners), which the
//   app then picks up instead of asking again (src/lib/earlyData.js);
// - on a product page, the download of the photo the page opens on, and on the
//   homepage the first hero banner, as a high-priority preload with the very
//   same `srcset`/`sizes` the <img> uses, so the browser keeps one download.
//
// This function is turned into a few lines of inline script by vite.config.js
// (`earlyStart`), so it must be self-contained: no imports, no outer names,
// nothing the oldest phones' browsers cannot run. Everything it needs arrives
// in `cfg`. It never throws and never changes what the page shows: if any of
// it fails, the app simply makes its own reads as it always has.
export function earlyStart(win, cfg) {
  try {
    var path = String(win.location.pathname || '/').replace(/\/+$/, '') || '/'
    // The dashboard reads with the owner's own session; leave it alone.
    if (/^\/admin(\/|$)/.test(path)) return
    // A coming-back sign-in (Google returns tokens or a code in the address)
    // is about to become a session: its reads must carry that session.
    if (/access_token=|refresh_token=|[?&]code=/.test(String(win.location.hash || '') + String(win.location.search || ''))) return
    // A signed-in visitor (the owner, a customer with an account) may be
    // allowed to see more rows than an anonymous read returns, so their reads
    // stay with the app. supabase-js keeps the session under `sb-<ref>-auth-token`.
    var store = null
    try { store = win.localStorage } catch (e) { store = null }
    for (var i = 0; store && i < store.length; i++) {
      if (/^sb-.+-auth-token$/.test(String(store.key(i) || ''))) return
    }

    var base = String(cfg.url || '').replace(/\/+$/, '')
    if (!base || !cfg.key || typeof win.fetch !== 'function') return
    var read = function (query) {
      return win.fetch(base + '/rest/v1/' + query, { headers: { apikey: cfg.key } }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
    }
    var quiet = function (p) { p.then(null, function () {}); return p }

    // The exact queries the app makes (ProductsContext, CategoriesContext,
    // RatingsContext, the homepage hero), so the answers are the same rows.
    var box = win.__ruhiEarly = {}
    box.products = quiet(read('products?select=*&order=created_at.desc,id.asc'))
    box.categories = quiet(read('categories?select=*&order=position.asc,key.asc'))
    box.ratings = quiet(read('product_reviews?select=product_id,rating&status=eq.approved&order=id.asc&offset=0&limit=' + cfg.ratingsPage))
    if (path === '/') box.banners = quiet(read('banners?select=*&slot=eq.' + cfg.heroSlot + '&order=position.asc,created_at.asc'))

    // An uploaded photo's resized copies, exactly as src/lib/imageSrcSet.js
    // builds them. A photo stored anywhere else is not preloaded.
    var storage = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/([^?#]+)$/
    var resized = function (src, width) {
      var m = storage.exec(String(src || ''))
      return m ? m[1] + '/render/image/public/' + m[2] + '?width=' + width + '&resize=contain&quality=' + cfg.quality : null
    }
    var preload = function (src, sizes) {
      var small = resized(src, cfg.smallWidth)
      if (!small) return
      var doc = win.document
      var link = doc.createElement('link')
      link.rel = 'preload'
      link.setAttribute('as', 'image')
      link.href = small
      link.setAttribute('imagesrcset', cfg.widths.map(function (w) { return resized(src, w) + ' ' + w + 'w' }).join(', '))
      link.setAttribute('imagesizes', sizes)
      link.setAttribute('fetchpriority', 'high')
      doc.head.appendChild(link)
    }

    // A product page opens on its colour's first photo (ProductsContext's
    // gallery order, which the page's Gallery shows first).
    var product = /^\/product\/([^/]+)$/.exec(path)
    if (product) {
      var id = decodeURIComponent(product[1])
      box.products.then(function (rows) {
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r]
          if (!row || row.id !== id) continue
          var shots = (Array.isArray(row.gallery) ? row.gallery : []).concat([row.image, row.hover]).filter(Boolean)
          if (shots.length) preload(shots[0], cfg.sizes.product)
          return
        }
      }, function () {})
    }
    // The homepage hero opens on the owner's first active banner.
    if (box.banners) {
      box.banners.then(function (rows) {
        for (var b = 0; b < rows.length; b++) {
          var banner = rows[b]
          if (!banner || banner.is_active === false || typeof banner.image !== 'string' || !banner.image.trim()) continue
          preload(banner.image, cfg.sizes.hero)
          return
        }
      }, function () {})
    }
  } catch (e) {
    // Nothing here is needed for the page to work.
  }
}
