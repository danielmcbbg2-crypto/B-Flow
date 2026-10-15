import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  // Relative base so the build works from any host path (the app uses hash routing).
  base: './',
  plugins: [react()],
  build: {
    // `vite build --mode single-file` embeds images in the bundle, for a self-contained demo page.
    assetsInlineLimit: mode === 'single-file' ? 100_000_000 : 4096,
  },
}))
