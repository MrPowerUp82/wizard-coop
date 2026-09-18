import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Caminhos relativos funcionam no GitHub Pages em qualquer subdiretório do repositório.
  base: './',
  // Console ports build into platforms/*; rewriting those files must not restart or crash the web dev server.
  server: { watch: { ignored: ['**/platforms/**'] } },
  plugins: [VitePWA({
    registerType: 'prompt',
    manifest: {
      id: './', name: 'Arcana Survivors', short_name: 'Arcana', lang: 'pt-BR',
      description: 'Sobreviva aos seis reinos, mesmo sem internet.',
      start_url: './', scope: './', display: 'standalone',
      theme_color: '#090d18', background_color: '#090d18',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,webp,png,woff,woff2,webmanifest}'],
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true
    }
  })]
});
