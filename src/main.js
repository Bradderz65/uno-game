import { $ } from './lib/dom.js';
import { session } from './lib/storage.js';
import { connect, request } from './net.js';
import { sounds } from './sounds.js';
import { confirmDialog, enableBackdropClose, initRulesDialog } from './ui/dialogs.js';
import { GameScreen } from './ui/game.js';
import { HomeScreen } from './ui/home.js';
import { LobbyScreen } from './ui/lobby.js';
import { toast } from './ui/toast.js';

const SESSION_KEY = 'seat';

/**
 * Top-level controller: owns the socket and the current room state, and
 * routes it to whichever screen matches the room's phase.
 */
class App {
    constructor() {
        this.state = null;
        this.screen = null;
        this.socket = connect();
        this.home = new HomeScreen(this);
        this.lobby = new LobbyScreen(this);
        this.game = new GameScreen(this);

        initRulesDialog();
        enableBackdropClose($('#rules-dialog'));
        enableBackdropClose($('#color-dialog'));
        this.initSoundToggle();
        this.bindSocket();

        // Show home right away unless we're about to resume a seat.
        if (!session.get(SESSION_KEY)) this.show('home');
    }

    request(event, payload) {
        return request(this.socket, event, payload);
    }

    /** Send an action; surface errors as toasts unless the caller handles them. */
    async action(event, payload = {}, { quiet = false } = {}) {
        const result = await this.request(event, payload);
        if (result.error && !quiet) {
            sounds.error();
            toast(result.error, 'error');
        }
        return result;
    }

    // ------------------------------------------------------------ routing

    show(name) {
        if (this.screen === name) return;
        this.screen = name;
        for (const screen of ['home', 'lobby', 'game']) {
            if (screen !== name) this[screen].hide();
        }
        this[name].show();
        window.scrollTo(0, 0);
    }

    applyState(state) {
        this.state = state;
        if (state.phase === 'lobby') {
            this.show('lobby');
            this.lobby.render(state);
        } else {
            this.show('game');
            this.game.render(state);
        }
    }

    // ------------------------------------------------------------ rooms

    async createRoom(name) {
        const result = await this.action('room:create', { name });
        if (result.ok) this.remember(result);
    }

    async joinRoom(code, name) {
        const result = await this.action('room:join', { code, name });
        if (result.ok) {
            this.remember(result);
            history.replaceState(null, '', location.pathname);
        }
    }

    async resume() {
        const seat = session.get(SESSION_KEY);
        if (!seat) return;
        const result = await this.request('room:resume', seat);
        if (result.ok) return;
        session.remove(SESSION_KEY);
        this.state = null;
        this.show('home');
        toast(result.error ?? 'Couldn’t rejoin your game', 'warning');
    }

    remember({ code, token }) {
        session.set(SESSION_KEY, { code, token });
    }

    async leaveRoom({ confirm = true } = {}) {
        const inGame = this.state?.phase === 'playing';
        if (confirm) {
            const ok = await confirmDialog({
                title: inGame ? 'Leave this game?' : 'Leave this room?',
                text: inGame ? 'Your cards go back into the deck and you can’t rejoin this round.' : 'You can join again with the room code.',
                confirmLabel: 'Leave'
            });
            if (!ok) return;
        }
        await this.request('room:leave');
        this.exitRoom();
    }

    exitRoom(message, type = 'info') {
        session.remove(SESSION_KEY);
        this.state = null;
        this.show('home');
        if (message) toast(message, type);
    }

    // ------------------------------------------------------------ socket

    bindSocket() {
        const banner = $('#connection-banner');
        let everConnected = false;

        this.socket.on('connect', () => {
            banner.hidden = true;
            if (everConnected) toast('Back online', 'success', 1800);
            everConnected = true;
            this.resume();
        });

        this.socket.on('disconnect', () => {
            $('#connection-text').textContent = 'Connection lost — reconnecting…';
            banner.hidden = false;
        });

        this.socket.on('connect_error', () => {
            $('#connection-text').textContent = everConnected ? 'Reconnecting…' : 'Can’t reach the game server — retrying…';
            banner.hidden = false;
            if (!this.screen) this.show('home');
        });

        this.socket.on('room:state', state => this.applyState(state));

        this.socket.on('room:event', event => {
            if (this.screen === 'game') this.game.onEvent(event);
            if (event.playerId === this.state?.you) return;
            if (event.type === 'join') {
                sounds.playerJoin();
                if (this.screen === 'game') toast(`${event.name} joined`, 'info', 2000);
            } else if (event.type === 'leave') {
                sounds.playerLeave();
                toast(`${event.name} ${event.reason === 'kicked' ? 'was removed' : 'left the room'}`, 'info', 2200);
            }
        });

        this.socket.on('room:kicked', () => this.exitRoom('The host removed you from the room', 'error'));
        this.socket.on('room:replaced', () => {
            this.state = null;
            this.show('home');
            toast('This game was opened in another tab', 'warning');
        });
    }

    initSoundToggle() {
        const button = $('#sound-btn');
        const sync = () => {
            button.setAttribute('aria-pressed', String(!sounds.enabled));
            button.setAttribute('aria-label', sounds.enabled ? 'Mute sound' : 'Unmute sound');
            button.querySelector('use').setAttribute('href', sounds.enabled ? '#i-volume' : '#i-volume-off');
        };
        button.addEventListener('click', () => {
            sounds.toggle();
            sync();
        });
        sync();
    }
}

try {
    window.app = new App();
} catch (err) {
    console.error(err);
    document.body.innerHTML = `<div class="screen" style="display:grid;place-items:center;text-align:center"><div class="panel" style="max-width:420px"><h1 class="dialog-title">Can’t reach the server</h1><p class="muted" style="margin:12px 0 20px">Make sure the UNO server is running, then reload this page.</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div></div>`;
}
