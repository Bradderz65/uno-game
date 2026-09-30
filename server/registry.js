import fs from 'fs';
import path from 'path';
import { GameRoom, PHASES } from './room.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O: easy to read aloud
const SAVE_DEBOUNCE_MS = 400;

/** Owns every live room and persists in-progress games to disk. */
export class RoomRegistry {
    constructor({ stateFile, timing } = {}) {
        this.rooms = new Map();
        this.stateFile = stateFile;
        this.timing = timing;
        this.saveTimer = null;
    }

    roomOptions() {
        return {
            timing: this.timing,
            onChange: () => this.scheduleSave(),
            onClose: room => this.remove(room.code)
        };
    }

    create() {
        const room = new GameRoom(this.generateCode(), this.roomOptions());
        this.rooms.set(room.code, room);
        return room;
    }

    get(code) {
        return this.rooms.get(String(code ?? '').trim().toUpperCase()) ?? null;
    }

    remove(code) {
        const room = this.rooms.get(code);
        if (!room) return;
        this.rooms.delete(code);
        room.close();
        console.log(`[Room ${code}] closed`);
        this.scheduleSave();
    }

    listOpen() {
        return [...this.rooms.values()]
            .filter(room => !room.canJoin())
            .map(room => room.summary());
    }

    generateCode() {
        let code;
        do {
            code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
        } while (this.rooms.has(code));
        return code;
    }

    // ------------------------------------------------------- persistence

    scheduleSave() {
        if (!this.stateFile || this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
        }, SAVE_DEBOUNCE_MS);
    }

    saveNow() {
        if (!this.stateFile) return;
        // Only games in progress are worth restoring; lobbies re-form in seconds.
        const data = {};
        for (const room of this.rooms.values()) {
            if (room.phase === PHASES.PLAYING) data[room.code] = room.toJSON();
        }
        try {
            fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
            const tmp = `${this.stateFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, this.stateFile);
        } catch (err) {
            console.error('Failed to save game state:', err.message);
        }
    }

    load() {
        if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
        try {
            const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            let restored = 0;
            for (const saved of Object.values(data)) {
                const room = GameRoom.restore(saved, this.roomOptions());
                if (!room || room.phase !== PHASES.PLAYING) continue;
                this.rooms.set(room.code, room);
                restored += 1;
            }
            if (restored) console.log(`Restored ${restored} game(s) in progress.`);
        } catch (err) {
            console.error('Failed to load saved games:', err.message);
        }
    }
}
