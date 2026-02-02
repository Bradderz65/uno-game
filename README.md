# UNO Multiplayer

Real-time multiplayer UNO game for local network play. Host a room, invite friends with a code, and add bots to fill seats.

## Features
- Lobby with room codes and auto-refresh
- Host controls for starting games and adding bots
- Full UNO rules with stacking +2/+4, reverse/skip, and wilds
- Multi-card plays for identical cards
- Animated dealing, drawing, and play actions

## Getting Started

### Install
```bash
npm install
```

### Run (dev)
```bash
npm run dev
```

### Run (server only)
```bash
npm start
```

Open `http://localhost:3000` in your browser.

## How to Play
1. Click **Create Game** and share the room code.
2. Add bots from the waiting room if you want.
3. Start the game when at least two players are ready.

## Tech
- Node.js + Express
- Socket.IO
- Vite
