import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    /*
     * Vite warns about any chunk over 500 kB, a threshold picked for pages
     * that should load fast on a slow connection. Phaser alone is 1.7 MB
     * minified, and it already sits in its own chunk that the browser caches
     * until Phaser itself changes, so the warning says nothing actionable here.
     * The limit sits just above it, so a chunk that grows past Phaser still
     * gets flagged.
     */
    chunkSizeWarningLimit: 2000,
    // Phaser is large and stable; splitting it keeps the game bundle diffable.
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      /*
       * Ignore browsers' half-written downloads.
       *
       * Source art gets saved straight into `art/`, and Chrome writes a locked
       * `.crdownload` placeholder while a file lands. Vite's watcher tried to
       * open one, got EBUSY, and the watcher's error event took the whole dev
       * server down mid-session — an unrelated background download killing the
       * build is not a failure anyone should have to diagnose twice.
       */
      ignored: ['**/*.crdownload', '**/*.part', '**/Unconfirmed*'],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
