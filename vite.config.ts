import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  // Public pages have real addresses (/store/<id>/<name>), so files load from the site's root. The
  // self-contained demo page keeps relative links so it opens from anywhere.
  base: mode === 'single-file' ? './' : '/',
  plugins: [react()],
  build: {
    // `vite build --mode single-file` embeds images in the bundle, for a self-contained demo page.
    assetsInlineLimit: mode === 'single-file' ? 100_000_000 : 4096,
  },
}))
