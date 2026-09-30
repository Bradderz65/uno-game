// Socket.IO event wiring. Each socket is bound to at most one seat via
// socket.data, so clients never need to send their room code with actions.

export function registerHandlers(io, registry) {
    io.on('connection', socket => {
        socket.data.roomCode = null;
        socket.data.playerId = null;

        const on = (event, handler) => {
            socket.on(event, (payload, ack) => {
                if (typeof payload === 'function') [payload, ack] = [undefined, payload];
                const reply = typeof ack === 'function' ? ack : () => {};
                try {
                    reply(handler(payload ?? {}) ?? { ok: true });
                } catch (err) {
                    console.error(`[${event}]`, err);
                    reply({ error: 'Something went wrong on the server.' });
                }
            });
        };

        const seat = () => {
            const room = registry.get(socket.data.roomCode);
            const player = room?.getPlayer(socket.data.playerId);
            // A seat reopened in another tab takes over; this socket loses control.
            return player && player.socket === socket ? { room, player } : null;
        };

        const withSeat = handler => payload => {
            const current = seat();
            if (!current) return { error: 'You’re not in a room.' };
            return handler(current, payload);
        };

        const bind = (room, player) => {
            leaveCurrent();
            socket.data.roomCode = room.code;
            socket.data.playerId = player.id;
            return { ok: true, code: room.code, playerId: player.id, token: player.token };
        };

        const leaveCurrent = () => {
            const current = seat();
            socket.data.roomCode = null;
            socket.data.playerId = null;
            if (current) current.room.removePlayer(current.player.id, 'left');
        };

        on('rooms:list', () => ({ ok: true, rooms: registry.listOpen() }));

        on('room:create', ({ name }) => {
            const room = registry.create();
            const { player, error } = room.addHuman(name, socket);
            if (error) {
                registry.remove(room.code);
                return { error };
            }
            console.log(`[Room ${room.code}] created by ${player.name}`);
            return bind(room, player);
        });

        on('room:join', ({ code, name }) => {
            const room = registry.get(code);
            if (!room) return { error: 'No room with that code.' };
            const { player, error } = room.addHuman(name, socket);
            if (error) return { error };
            return bind(room, player);
        });

        on('room:resume', ({ code, token }) => {
            const room = registry.get(code);
            if (!room) return { error: 'That room has closed.' };
            const player = room.resume(token, socket);
            if (!player) return { error: 'Your seat in that room is gone.' };
            socket.data.roomCode = room.code;
            socket.data.playerId = player.id;
            return { ok: true, code: room.code, playerId: player.id, token: player.token };
        });

        on('room:leave', () => {
            leaveCurrent();
            return { ok: true };
        });

        on('room:addBot', withSeat(({ room, player }) => room.addBot(player.id)));
        on('room:kick', withSeat(({ room, player }, { playerId }) => room.kick(player.id, playerId)));
        on('room:settings', withSeat(({ room, player }, { settings }) => room.updateSettings(player.id, settings ?? {})));
        on('room:start', withSeat(({ room, player }) => room.requestStart(player.id)));
        on('room:ready', withSeat(({ room, player }, { ready }) => room.setReady(player.id, ready !== false)));
        on('room:lobby', withSeat(({ room, player }) => room.returnToLobby(player.id)));

        on('game:play', withSeat(({ room, player }, { cardIds, color }) => room.play(player.id, cardIds, color)));
        on('game:draw', withSeat(({ room, player }) => {
            const result = room.draw(player.id);
            return result.error ? result : { ok: true };
        }));
        on('game:pass', withSeat(({ room, player }) => room.pass(player.id)));
        on('game:uno', withSeat(({ room, player }) => room.callUno(player.id)));

        socket.on('disconnect', () => {
            const current = seat();
            if (!current || current.player.socket !== socket) return;
            current.room.disconnect(current.player.id);
        });
    });
}
