import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { RoomRegistry } from './registry.js';
import { registerHandlers } from './handlers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const STATE_FILE = process.env.UNO_STATE_FILE || path.join(ROOT, 'server', 'data', 'gamestate.json');
const DIST = path.join(ROOT, 'dist');
// `--dist` (or NODE_ENV=production) serves the Vite build instead of the source files.
const WANT_DIST = process.argv.includes('--dist') || process.env.NODE_ENV === 'production';
const USE_DIST = WANT_DIST && fs.existsSync(path.join(DIST, 'index.html'));

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Only ship what the browser needs — never the server folder or saved games.
if (USE_DIST) {
    app.use(express.static(DIST));
} else {
    app.use('/src', express.static(path.join(ROOT, 'src')));
    app.use('/shared', express.static(path.join(ROOT, 'shared')));
    app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
}

const localIP = getLocalIP();
app.get('/api/network-url', (req, res) => {
    res.json({ url: `${req.protocol}://${localIP}:${PORT}/` });
});

const registry = new RoomRegistry({ stateFile: STATE_FILE });
registry.load();
registerHandlers(io, registry);

function getLocalIP() {
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (address.family === 'IPv4' && !address.internal) return address.address;
        }
    }
    return 'localhost';
}

function shutdown() {
    registry.saveNow();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🎮 UNO Server Started!\n');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://${localIP}:${PORT}`);
    console.log('\nShare the network URL with players on your local network!\n');
});
