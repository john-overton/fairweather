import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

import { themeBootstrapScript } from './web/lib/theme.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Inlines the stored-theme script in <head> so the right palette is set before first paint (no flash). Appended, not prepended: it updates the theme-color <meta>, which must already be parsed. */
const themeBootstrap = (): Plugin => ({
  name: 'fw-theme-bootstrap',
  transformIndexHtml: () => [{ tag: 'script', children: themeBootstrapScript(), injectTo: 'head' }],
});

/** Dev only: /fairweather (no slash) is the canonical URL and the PWA start_url, but Vite's base middleware 404s it. The production server serves it. */
const bareBase = (): Plugin => ({
  name: 'fw-bare-base',
  configureServer: (server) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/fairweather(\?|$)/.test(req.url)) req.url = req.url.replace('/fairweather', '/fairweather/');
      next();
    });
  },
});

// Served under /fairweather by the Hono server (see server/); in dev Vite serves the SPA and proxies the API.
export default defineConfig({
  root: 'web',
  base: '/fairweather/',
  publicDir: '../public',
  envDir: root,
  plugins: [react(), themeBootstrap(), bareBase()],
  resolve: { alias: { '@': root.replace(/\/$/, '') } },
  server: {
    host: '127.0.0.1',
    port: 3100,
    strictPort: true,
    // Lets /fairweather/sw.js control scope /fairweather (no trailing slash), as the production server does
    headers: { 'Service-Worker-Allowed': '/fairweather' },
    proxy: { '/fairweather/api': 'http://127.0.0.1:3101' },
  },
  // The lazy Radar chunk is ~1.9 MB because of Mapbox GL; anything else that large would still warn
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
