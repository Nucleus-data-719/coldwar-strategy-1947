import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// The dev server proxies /api and /socket.io to the Nest server so cookies stay same-origin.
// If you change PORT in .env, change the target below too.
const SERVER = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@cw/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // Listen on the network so friends can join your test (see docs/PLAYTEST.md).
    host: true,
    // Lets a tunnel address (ngrok, cloudflared) reach the dev server. Needs Vite 5.4.12+, ignored by older ones.
    allowedHosts: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/socket.io': { target: SERVER, ws: true },
    },
  },
});
