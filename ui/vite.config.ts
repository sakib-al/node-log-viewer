import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Built assets are shipped inside the npm package under dist/ui and served by
// src/server/static.ts, which rewrites the absolute "/assets/..." URLs to the
// path the viewer is mounted at.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // during development run an example app (e.g. examples/express-js on :4000)
      '/api': { target: 'http://localhost:4000/logs', changeOrigin: true },
    },
  },
});
