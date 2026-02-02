import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './room.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SAVE_FILE = join(__dirname, 'gamestate.json');

export const StateManager = {
    save(rooms) {
        const data = {};
        for (const [code, room] of rooms) {
            data[code] = room.toJSON();
        }
        try {
            fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('Failed to save game state:', err);
        }
    },

    load(io) {
        const rooms = new Map();
        try {
            if (fs.existsSync(SAVE_FILE)) {
                const raw = fs.readFileSync(SAVE_FILE, 'utf8');
                const data = JSON.parse(raw);
                for (const [code, roomState] of Object.entries(data)) {
                    const room = GameRoom.restore(roomState, io);
                    rooms.set(code, room);
                }
                console.log(`Restored ${rooms.size} rooms from save file.`);
            }
        } catch (err) {
            console.error('Failed to load game state:', err);
        }
        return rooms;
    }
};
