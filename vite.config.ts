import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const ICON_CACHE_VERSION = 'v=3';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'favicon.png',
          'apple-touch-icon.png',
          'brand-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'sw-push.js',
        ],
        manifest: {
          id: '/?v=3',
          name: 'Yemen Task - كسب اليمن',
          short_name: 'Yemen Task',
          description: 'منصة رقمية يمنية متكاملة للمهام المصغرة وكسب الريال اليمني وسحب الأرباح',
          theme_color: '#059669',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          dir: 'rtl',
          lang: 'ar',
          start_url: '/?source=pwa&v=3',
          scope: '/',
          icons: [
            {
              src: `/pwa-192x192.png?${ICON_CACHE_VERSION}`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `/pwa-512x512.png?${ICON_CACHE_VERSION}`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `/pwa-maskable-512x512.png?${ICON_CACHE_VERSION}`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/sw-push.js'],
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          ignoreURLParametersMatching: [/^v$/, /^source$/],
          globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/*.html', '**/*.apk', '.well-known/**'],
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/.well-known/') || /\.apk$/i.test(url.pathname),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ request, url }) =>
                (request.mode === 'navigate' || request.destination === 'document') &&
                !url.pathname.startsWith('/api/') &&
                !url.pathname.startsWith('/.well-known/') &&
                !/\.apk$/i.test(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-pages-network-first',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) =>
                /^\/api\/(auth|wallet|admin|withdrawals|yt-coin)(\/|$)/i.test(url.pathname),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ request, url }) =>
                request.method === 'GET' &&
                (url.pathname.startsWith('/api/') || url.pathname.endsWith('.json')) &&
                !url.pathname.startsWith('/.well-known/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-data-network-first',
                networkTimeoutSeconds: 5,
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 12,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: process.env.DISABLE_HMR !== 'true',
          type: 'module',
        },
      }),
      {
        name: 'disable-vite-client-ws-when-hmr-off',
        apply: 'serve',
        transform(code, id) {
          const isHmrDisabled = process.env.DISABLE_HMR === 'true';
          if (isHmrDisabled && id.replace(/\\/g, '/').endsWith('/vite/dist/client/client.mjs')) {
            return code
              .replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR disabled: WebSocket connect skipped */'
              )
              .replace(
                'throw new Error("send was called before connect");',
                'return; /* HMR disabled: ignore send before connect */'
              );
          }
          return null;
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      ...(process.env.DISABLE_HMR === 'true' ? { ws: false as const } : {}),
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
