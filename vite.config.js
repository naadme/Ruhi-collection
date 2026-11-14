import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { earlyStart } from './src/boot/earlyStart.js'
import { HERO_PHOTO_SIZES, IMAGE_SIZES, PRODUCT_PHOTO_SIZES, UPLOAD_QUALITY, UPLOAD_WIDTHS } from './src/lib/imageSrcSet.js'
import { HOME_HERO_SLOT } from './src/lib/bannerSlot.js'

// Static hosts (GitHub Pages, S3, plain file servers) answer deep links such as
// /contact, /shop or /product/:id with their own 404 page, because there is no
// server-side rewrite to index.html. Emitting a copy of index.html as 404.html
// makes those hosts serve the SPA shell instead, while the browser keeps the
// requested URL — so React Router resolves the real route. No dependencies.
const spa404 = () => {
  let outDir = 'dist'
  return {
    name: 'spa-404',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    closeBundle() {
      const index = resolve(outDir, 'index.html')
      // When the build itself failed there is no index.html to copy — and
      // saying so here would hide the real error behind this one.
      if (!existsSync(index)) return
      copyFileSync(index, resolve(outDir, '404.html'))
    },
  }
}

// Checkout's code is its own file (src/lib/checkoutPage.js). Opened from the
// shop it has already been fetched ahead, but /checkout opened directly (a
// reload, a return from the payment app) would only ask for it once the main
// script had run. On that one address, a few bytes in the page ask for it
// straight away, alongside the main script. Every other page skips it.
// A plain `preload` only warms the browser's cache (the file is cached for a
// year). Not `modulepreload`: when that request failed, Chrome made the
// page's own import of the file wait about 13 s before trying again.
const preloadCheckoutOnCheckout = () => {
  let base = '/'
  return {
    name: 'preload-checkout-on-checkout',
    apply: 'build',
    configResolved(config) { base = config.base },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle || {}).find((c) => c.type === 'chunk' && c.isDynamicEntry && c.name === 'Checkout')
        if (!chunk) throw new Error('preload-checkout-on-checkout: no Checkout chunk in the build')
        const href = JSON.stringify(base + chunk.fileName)
        const script = `<script>if(location.pathname.replace(/\\/+$/,'')==='/checkout'){var l=document.createElement('link');l.rel='preload';l.as='script';l.crossOrigin='';l.href=${href};document.head.appendChild(l)}</script>`
        return html.replace('</head>', `  ${script}\n  </head>`)
      },
    },
  }
}

// The page starts its own slowest work in its first milliseconds, before the
// app's code has arrived (src/boot/earlyStart.js explains what and why):
// - an inline script, placed right after the GTM snippet and before any
//   stylesheet (a script after a stylesheet waits for it), that starts the
//   app's first database reads and preloads the photo the page opens on;
// - a `preconnect` to the photo server, so that photo does not also wait for
//   a new connection (photos and data reads use separate connections).
// The script is the function's own source with its settings: the database's
// public address and publishable key (already public in the app's bundle) and
// the photo sizes the app itself uses, so the two cannot drift apart.
const earlyStartScript = () => {
  let settings = null
  return {
    name: 'early-start',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || config.root, 'VITE_')
      settings = {
        url: env.VITE_SUPABASE_URL,
        key: env.VITE_SUPABASE_PUBLISHABLE_KEY,
        widths: UPLOAD_WIDTHS,
        smallWidth: IMAGE_SIZES.small,
        quality: UPLOAD_QUALITY,
        sizes: { product: PRODUCT_PHOTO_SIZES, hero: HERO_PHOTO_SIZES },
        heroSlot: HOME_HERO_SLOT,
        ratingsPage: 1000,
      }
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        // No database settings, no early start: the app reads as it always did.
        if (!settings?.url || !settings?.key) return html
        const marker = '<!-- End Google Tag Manager -->'
        const call = `(${earlyStart.toString()})(window,${JSON.stringify(settings).replace(/</g, '\\u003c')});`
        // Minified to a few hundred bytes; es2017 runs on every phone the shop supports.
        const { code } = await transformWithEsbuild(call, 'early-start.js', { minify: true, target: 'es2017' })
        const script = `<script>${code.trim()}</script>`
        const origin = new URL(settings.url).origin
        const preconnect = `<link rel="preconnect" href="${origin}" />`
        const withScript = html.includes(marker)
          ? html.replace(marker, `${marker}\n${script}`)
          : html.replace('<head>', `<head>${script}`)
        return withScript.replace('<link rel="preconnect"', `${preconnect}<link rel="preconnect"`)
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), spa404(), preloadCheckoutOnCheckout(), earlyStartScript()],
  build: {
    // The build always starts from an empty output directory. A file left
    // behind by an earlier build must never be published again — a stale
    // photograph or asset is invisible in the source tree and easy to miss.
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Third-party code (React, Supabase, the router, Lucide) is effectively
        // frozen between deploys, while this app's own code is not. Hoisting it
        // into a single `vendor` chunk means the bulk of the payload — ~116 kB
        // gzip — is served from cache after the first visit instead of being
        // re-downloaded with every content update. Measured as byte-neutral
        // overall (~+0.1% gzip) for two requests instead of one over HTTP/2,
        // and it also keeps every emitted chunk under the 500 kB warning line.
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
})
