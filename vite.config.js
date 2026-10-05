import { copyFileSync } from 'node:fs'
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
    closeBundle() { copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html')) },
  }
}

export default defineConfig({
  plugins: [react(), spa404()],
  build: {
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
