import { defineConfig } from 'vite';

// In development Vite serves the client on :5173 and forwards the realtime
// socket and API calls to the game server on :3000.
const GAME_SERVER = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/socket.io': { target: GAME_SERVER, ws: true },
      '/api': GAME_SERVER
    }
  },
  build: {
    outDir: 'dist'
  }
});
