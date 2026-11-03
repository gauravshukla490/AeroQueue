import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy API requests to the Express backend
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/search': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
