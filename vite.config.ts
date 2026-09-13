import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

/**
 * إعداد Vite — دفتر الديون
 * - منفذين على 0.0.0.0 ليعمل داخل المعاينة
 * - allowedHosts مفتوح لأن المعاينة تُخدم عبر نطاق وسيط
 * - vite-plugin-pwa يوفّر manifest + Service Worker + تحديث تلقائي
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // لا نحقن سكربت تسجيل: نسجّل الـ SW بأنفسنا في src/app/pwa.ts (فحص تحديث + إعادة تحميل)
      injectRegister: null,
      strategies: 'generateSW',
      includeAssets: [
        'push-sw.js',
        'favicon.svg',
        'favicon.ico',
        'apple-touch-icon.png',
        'fonts/*.woff2',
        'icons/*.png',
      ],
      manifest: {
        name: 'دفتر الديون',
        short_name: 'دفتر الديون',
        description: 'دفتر بسيط لإدارة الديون والسداد',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        theme_color: '#0f7a5a',
        background_color: '#0b1220',
        categories: ['finance', 'productivity', 'business'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'الرئيسية', short_name: 'الرئيسية', url: '/#/' },
          { name: 'بانتظار تأكيدي', short_name: 'بانتظار', url: '/#/entries?filter=awaiting_me' },
          { name: 'الإشعارات', short_name: 'الإشعارات', url: '/#/notifications' },
          { name: 'المحلات/العملاء', short_name: 'السجلات', url: '/#/parties' },
        ],
      },
      workbox: {
        // سكربت إشعارات الدفع يُحمَّل داخل الـ SW المُولَّد (يعمل والتطبيق مغلق)
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,woff2,png,svg,ico,webmanifest}'],
        // HTML لا يُخزَّن مسبقًا أبدًا: يُخدَم من الشبكة (NetworkFirst أدناه)
        // ⇒ أول تحديث للصفحة يُظهر دائمًا أحدث نسخة من التطبيق
        globIgnores: ['**/index.html'],
        // لا مسار احتياطي مخزَّن للـ HTML: التنقّل يمرّ عبر قاعدة NetworkFirst أدناه
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // واجهة التطبيق: الشبكة أولًا مع رجوع سريع للكاش
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // طلبات Supabase REST — نتائج متجددة مع تخزين مؤقت قصير للقراءة بلا اتصال
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // لا يتم تخزين أي طلب كتابة أو مصادقة أبدًا
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/(auth|rest)\/.*/i,
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|woff2?)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('@tanstack')) return 'vendor-query'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('react-router')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
})
