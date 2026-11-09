import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the Express backend.
// Set AEROQUEUE_API to point the dev server at a remote backend.
const target = process.env.AEROQUEUE_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target, changeOrigin: true, secure: true } },
  },
});
