import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, PHASES } from '../server/room.js';
import { CARD_TYPES } from '../shared/rules.js';

const FAST = {
    dealStartDelay: 0,
    dealRoundDelay: 0,
    botThink: [0, 0],
    botAfterDraw: [0, 0],
    drawSettle: () => 0,
    disconnectGrace: 50
};

function fakeSocket() {
    const sent = [];
    return {
        sent,
        emit: (event, data) => sent.push({ event, data }),
        last: event => [...sent].reverse().find(m => m.event === event)?.data
    };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startedRoom(players = 2) {
    const room = new GameRoom('TEST', { timing: FAST });
    const sockets = [];
    for (let i = 0; i < players; i++) {
        const socket = fakeSocket();
        room.addHuman(`P${i}`, socket);
        sockets.push(socket);
    }
    room.requestStart(room.players[0].id);
    await wait(20);
    assert.equal(room.dealing, false);
    return { room, sockets };
}

function setTable(room, top, color = top.color) {
    room.discard = [top];
    room.currentColor = color;
    room.drawStack = 0;
}

const card = (id, color, type, value) => ({ id, color, type, value });

test('first human is host and names are de-duplicated', () => {
    const room = new GameRoom('TEST', { timing: FAST });
    const a = room.addHuman('  Sam  ', fakeSocket()).player;
    const b = room.addHuman('sam', fakeSocket()).player;
    assert.equal(room.hostId, a.id);
    assert.equal(a.name, 'Sam');
    assert.equal(b.name, 'sam 2');
    assert.ok(room.addHuman('   ', fakeSocket()).error);
});

test('only the host can start, and a game needs two players', () => {
    const room = new GameRoom('TEST', { timing: FAST });
    const host = room.addHuman('Host', fakeSocket()).player;
    assert.match(room.requestStart(host.id).error, /two players/);
    const guest = room.addHuman('Guest', fakeSocket()).player;
    assert.match(room.requestStart(guest.id).error, /host/);
    assert.ok(room.requestStart(host.id).ok);
    assert.equal(room.phase, PHASES.PLAYING);
    room.close();
});

test('deals the configured number of cards', async () => {
    const room = new GameRoom('TEST', { timing: FAST });
    const host = room.addHuman('Host', fakeSocket()).player;
    room.addHuman('Guest', fakeSocket());
    room.updateSettings(host.id, { startingCards: 4 });
    room.requestStart(host.id);
    await wait(20);
    assert.deepEqual(room.players.map(p => p.hand.length), [4, 4]);
    room.close();
});

test('state sent to a player never includes other hands or tokens', async () => {
    const { room, sockets } = await startedRoom(2);
    const view = sockets[0].last('room:state');
    assert.equal(view.game.hand.length, room.players[0].hand.length);
    const json = JSON.stringify(view);
    assert.ok(!json.includes(room.players[1].token));
    assert.ok(!('hand' in view.players[1]));
    room.close();
});

test('playing a card moves the turn and rejects out-of-turn plays', async () => {
    const { room } = await startedRoom(3);
    room.currentIndex = 0;
    room.direction = 1;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    const [p0, p1] = room.players;
    p0.hand = [card(1, 'red', CARD_TYPES.NUMBER, 7), card(2, 'blue', CARD_TYPES.NUMBER, 1)];

    assert.match(room.play(p1.id, [1]).error, /not your turn/);
    assert.match(room.play(p0.id, [2]).error, /doesn’t match/);
    assert.ok(room.play(p0.id, [1]).ok);
    assert.equal(room.currentPlayer.id, p1.id);
    assert.equal(room.currentColor, 'red');
    room.close();
});

test('skip and reverse with three players', async () => {
    const { room } = await startedRoom(3);
    const [p0, p1, p2] = room.players;
    room.currentIndex = 0;
    room.direction = 1;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    p0.hand = [card(1, 'red', CARD_TYPES.SKIP, 'skip'), card(9, 'red', CARD_TYPES.NUMBER, 1)];
    room.play(p0.id, [1]);
    assert.equal(room.currentPlayer.id, p2.id);

    p2.hand = [card(2, 'red', CARD_TYPES.REVERSE, 'reverse'), card(8, 'red', CARD_TYPES.NUMBER, 1)];
    room.play(p2.id, [2]);
    assert.equal(room.direction, -1);
    assert.equal(room.currentPlayer.id, p1.id);
    room.close();
});

test('heads-up skip keeps the turn', async () => {
    const { room } = await startedRoom(2);
    const [p0] = room.players;
    room.currentIndex = 0;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    p0.hand = [card(1, 'red', CARD_TYPES.REVERSE, 'reverse'), card(2, 'red', CARD_TYPES.NUMBER, 1)];
    room.play(p0.id, [1]);
    assert.equal(room.currentPlayer.id, p0.id);
    room.close();
});

test('plus cards stack and the next player draws the total', async () => {
    const { room } = await startedRoom(3);
    const [p0, p1, p2] = room.players;
    room.currentIndex = 0;
    room.direction = 1;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    p0.hand = [card(1, 'red', CARD_TYPES.DRAW_TWO, '+2'), card(3, 'red', CARD_TYPES.NUMBER, 1)];
    p1.hand = [card(2, 'wild', CARD_TYPES.WILD_DRAW_FOUR, '+4'), card(4, 'red', CARD_TYPES.NUMBER, 1)];
    room.play(p0.id, [1]);
    assert.match(room.play(p1.id, [2]).error, /colour/);
    room.play(p1.id, [2], 'blue');
    assert.equal(room.drawStack, 6);
    const before = p2.hand.length;
    assert.ok(room.draw(p2.id).ok);
    assert.equal(p2.hand.length, before + 6);
    assert.equal(room.drawStack, 0);
    room.close();
});

test('must play instead of drawing when able; pass only after drawing', async () => {
    const { room } = await startedRoom(2);
    const [p0] = room.players;
    room.currentIndex = 0;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    p0.hand = [card(1, 'red', CARD_TYPES.NUMBER, 7), card(2, 'red', CARD_TYPES.NUMBER, 8)];
    assert.match(room.draw(p0.id).error, /can play/);
    assert.match(room.pass(p0.id).error, /Draw a card/);
    room.close();
});

test('forgetting UNO costs two cards and the play', async () => {
    const { room } = await startedRoom(2);
    const [p0] = room.players;
    room.currentIndex = 0;
    setTable(room, card(900, 'red', CARD_TYPES.NUMBER, 5));
    p0.hand = [card(1, 'red', CARD_TYPES.NUMBER, 7)];
    assert.match(room.play(p0.id, [1]).error, /UNO/);
    assert.equal(p0.hand.length, 3);

    p0.hand = [card(1, 'red', CARD_TYPES.NUMBER, 7)];
    assert.ok(room.callUno(p0.id).ok);
    assert.ok(room.play(p0.id, [1]).ok);
    assert.equal(room.phase, PHASES.FINISHED);
    assert.equal(room.results.winnerId, p0.id);
    room.close();
});

test('rematch starts when everyone is ready', async () => {
    const { room } = await startedRoom(2);
    const [p0, p1] = room.players;
    room.finish(p0, 'won');
    room.setReady(p0.id, true);
    assert.equal(room.phase, PHASES.FINISHED);
    room.setReady(p1.id, true);
    assert.equal(room.phase, PHASES.PLAYING);
    room.close();
});

test('leaving on your turn passes it on; last one standing wins', async () => {
    const { room } = await startedRoom(3);
    const [p0, p1, p2] = room.players;
    room.currentIndex = 1;
    room.direction = 1;
    room.removePlayer(p1.id);
    assert.equal(room.currentPlayer.id, p2.id);
    room.removePlayer(p2.id);
    assert.equal(room.phase, PHASES.FINISHED);
    assert.equal(room.results.winnerId, p0.id);
    assert.equal(room.results.reason, 'forfeit');
    room.close();
});

test('host leaving hands host to the next human; room closes with no humans', () => {
    let closed = false;
    const room = new GameRoom('TEST', { timing: FAST, onClose: () => { closed = true; } });
    const a = room.addHuman('A', fakeSocket()).player;
    const b = room.addHuman('B', fakeSocket()).player;
    room.addBot(a.id);
    room.removePlayer(a.id);
    assert.equal(room.hostId, b.id);
    room.removePlayer(b.id);
    assert.ok(closed);
});

test('disconnected players can resume with their token, or time out', async () => {
    const room = new GameRoom('TEST', { timing: FAST });
    const a = room.addHuman('A', fakeSocket()).player;
    const b = room.addHuman('B', fakeSocket()).player;
    room.disconnect(a.id);
    assert.equal(a.connected, false);
    assert.equal(room.resume('wrong', fakeSocket()), null);
    assert.equal(room.resume(a.token, fakeSocket()), a);
    assert.equal(a.connected, true);

    room.disconnect(b.id);
    await wait(80);
    assert.equal(room.getPlayer(b.id), null);
    room.close();
});

test('kicked players cannot resume', () => {
    const room = new GameRoom('TEST', { timing: FAST });
    const host = room.addHuman('Host', fakeSocket()).player;
    const guest = room.addHuman('Guest', fakeSocket()).player;
    assert.ok(room.kick(host.id, guest.id).ok);
    assert.equal(room.resume(guest.token, fakeSocket()), null);
    room.close();
});

test('state survives a save/restore round trip', async () => {
    const { room } = await startedRoom(2);
    const restored = GameRoom.restore(JSON.parse(JSON.stringify(room.toJSON())), { timing: FAST });
    assert.equal(restored.phase, PHASES.PLAYING);
    assert.deepEqual(restored.players.map(p => p.hand), room.players.map(p => p.hand));
    assert.equal(restored.currentColor, room.currentColor);
    assert.equal(restored.players.every(p => !p.connected), true);
    room.close();
    restored.close();
});

for (const botCount of [1, 3, 9]) {
    test(`a game with ${botCount} bot(s) always runs to completion`, { timeout: 60000 }, async () => {
        for (let game = 0; game < 15; game++) {
            let finished = false;
            const room = new GameRoom('SIM', { timing: FAST });
            try {
                const human = room.addHuman('Human', fakeSocket()).player;
                for (let i = 0; i < botCount; i++) room.addBot(human.id);
                // Let a bot sit in the human's seat so the whole table is automated.
                human.isBot = true;
                room.hasAudience = () => true;
                room.onChange = () => { if (room.phase === PHASES.FINISHED) finished = true; };
                room.updateSettings(human.id, { customCard: { enabled: game % 2 === 0, drawAmount: 6, count: 3 } });
                room.requestStart(human.id);

                const deadline = Date.now() + 5000;
                while (!finished && Date.now() < deadline) await wait(1);
                const total = room.deck.length + room.discard.length + room.players.reduce((s, p) => s + p.hand.length, 0);
                assert.ok(finished, `game ${game} stalled at turn ${room.turnSeq}`);
                assert.equal(total, 108 + (game % 2 === 0 ? 3 : 0), 'cards were lost or duplicated');
            } finally {
                // Always stop the bots, or a failed assertion leaves timers running and the run never exits.
                room.close();
            }
        }
    });
}
