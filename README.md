# UNO Multiplayer

Real-time UNO for your local network. Host a room, share the code (or QR), and play from any phone, tablet or computer on the same Wi-Fi. Fill empty seats with bots.

## Features

- Rooms with 4-letter codes, a live list of open rooms, and QR / share-link invites
- 2–10 players, with bots that play sensibly and pace themselves
- House rules the host can tweak: starting hand size and optional "mega draw" wild cards
- Stackable +2 / +4, multi-card plays, UNO calls with penalties
- Refresh or drop connection mid-game and you rejoin your seat automatically
- Responsive table layout for phones (portrait and landscape), tablets and desktops
- Keyboard shortcuts, sound effects, reduced-motion support

## Getting started

Requires Node.js 18 or newer.

```bash
npm install
npm start          # http://localhost:3000
```

Other players open the **Network** address printed in the terminal (or scan the QR code in the lobby).

On Windows you can double-click `start.bat` (or run `start.ps1`); on macOS/Linux use `./launch.sh`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Run the game server and serve the client from source. |
| `npm run dev` | Game server with auto-restart, plus Vite with hot reload on http://localhost:5173. |
| `npm test` | Rules and room tests, including full bot-vs-bot games. |
| `npm run build` | Build an optimised client into `dist/`. |
| `npm run preview` | Build, then serve `dist/` from the game server (`node server/index.js --dist`). |

Environment variables: `PORT` (default `3000`) and `UNO_STATE_FILE` (where games in progress are saved; default `server/data/gamestate.json`).

## House rules

- **Match** the top card by colour, number or symbol. Wilds go on anything.
- **Play multiples** — identical cards (or any mix of draw cards) can be played together; the last one chosen goes on top.
- **Stack draws** — +2, +4 and mega draws stack on each other; the first player who can't stack draws the total.
- **Must play if you can** — you can only draw when nothing fits. After drawing, play if possible, otherwise pass.
- **Finish on a number** — your final card can't be an action or wild card.
- **Call UNO** before playing your last card or take two penalty cards.
- **Heads up** — with two players, Skip and Reverse give you another turn.

## Project layout

```
shared/rules.js      Card definitions and rule checks, used by both server and client
server/
  index.js           HTTP + Socket.IO bootstrap and static file serving
  handlers.js        Socket events → room actions (each socket is bound to one seat)
  registry.js        Room lookup, room codes, saving games in progress to disk
  room.js            GameRoom: lobby, turn flow, rematches, state sent to each player
  bot.js             Bot move and colour selection
src/
  main.js            App controller: connection, session resume, screen routing
  net.js             Socket connection and request/ack helper
  ui/                home, lobby, game, hand, results, cards, dialogs, toasts, effects
  styles/            Design tokens, components, cards and per-screen styles
test/                node:test suites
```

The server is authoritative: clients send intents (`game:play` with card ids, `game:draw`, …) and receive a personalised `room:state` snapshot plus `room:event` entries used for animations, sounds and the move log. Nobody's hand or rejoin token is ever sent to other players.
