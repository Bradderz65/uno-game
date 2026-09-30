// Socket.IO client is served by our own server at /socket.io/socket.io.js
// (proxied by Vite in development), so everything stays same-origin.

export function connect() {
    if (typeof window.io !== 'function') {
        throw new Error('Could not reach the game server.');
    }
    return window.io({ reconnectionDelayMax: 4000 });
}

/** Emit an event and resolve with the server's acknowledgement. */
export function request(socket, event, payload = {}, timeoutMs = 8000) {
    return new Promise(resolve => {
        if (!socket.connected) {
            resolve({ error: 'Not connected to the server.' });
            return;
        }
        socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
            resolve(err ? { error: 'The server didn’t respond. Try again.' } : (response ?? { ok: true }));
        });
    });
}
