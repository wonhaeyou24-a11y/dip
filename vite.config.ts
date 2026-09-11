import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages: https://<user>.github.io/dip/  → base must be '/dip/'
// 로컬 개발(dev)에서는 '/' 로 두어 편하게 접근
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dip/' : '/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '불연속면 조사 (DiscontinuityShot)',
        short_name: 'DIP',
        description: '불연속면 주향·경사 측정 + 절리상태 조사 현장앱',
        lang: 'ko',
        theme_color: '#1f2937',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PORT) || 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
