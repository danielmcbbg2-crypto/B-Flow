import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the build works from any host path (the app uses hash routing).
  base: './',
  plugins: [react()],
})
