import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base 用相对路径：同一份构建既能放在根路径，也能放在 GitHub Pages 的子路径下。
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'Personal Kitchen OS',
        short_name: '厨房',
        description: '个人厨房助手：今天吃什么、库存、采购，本地优先。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f3ea',
        theme_color: '#2f5d50',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        // AI 辅助服务绝不进入离线缓存：它要么实时可用，要么明确显示不可用。
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/domain/**/*.test.ts', 'tests/data/**/*.test.ts', 'tests/server/**/*.test.ts'],
  },
});
