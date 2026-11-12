import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), spa404(), preloadCheckoutOnCheckout()],
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
