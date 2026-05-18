import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Scrape + publish ~30-60s. Image regen chain (vision + prompt +
        // gpt-image-2) can run 60-180s, so 5 min covers all cases.
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
});
