/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Ticket 07: `generateSW`, precache the hashed shell only, no runtime caching —
// Firestore uses IndexedDB, not Cache Storage, so there is nothing for Workbox to cache.
// Ticket 10 / Badrish 2026-08-26: update mode is `prompt`, locked by the first deploy.
export default defineConfig({
  // Ticket 04 lists `http://localhost:5173/*` and `http://localhost:4173/*` on the API key's
  // referrer restriction explicitly, because port wildcards are not reliably honoured. Vite's
  // default is to increment past a busy port, and an unlisted port fails at sign-in with a 403
  // that reads as an auth bug. `strictPort` makes it refuse to start instead — a failure that
  // names itself. Guarded by src/test/devServerPorts.test.ts. (builder, 2026-08-27)
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null, // registration is explicit in src/platform/serviceWorker.ts
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [],
      },
      manifest: {
        name: 'NoteMaker',
        short_name: 'NoteMaker',
        description: 'Markdown notes that work offline and sync across your devices.',
        theme_color: '#1c1917',
        background_color: '#1c1917',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
