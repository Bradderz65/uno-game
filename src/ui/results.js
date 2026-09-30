import { $, h, icon, avatar } from '../lib/dom.js';
import { confetti } from './fx.js';

function ordinal(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

export class Results {
    constructor(app) {
        this.app = app;
        this.dialog = $('#results-dialog');
        this.reopenBtn = $('#results-reopen');
        this.readyBtn = $('#results-ready');
        this.peeking = false;
        this.state = null;

        this.readyBtn.addEventListener('click', () => {
            const ready = !this.state?.ready.includes(this.state.you);
            this.app.action('room:ready', { ready });
        });
        $('#results-leave').addEventListener('click', () => this.app.leaveRoom({ confirm: false }));
        $('#results-lobby').addEventListener('click', () => this.app.action('room:lobby'));
        $('#results-peek').addEventListener('click', () => this.peek());
        this.reopenBtn.addEventListener('click', () => {
            this.peeking = false;
            this.open();
        });
        // Esc means "let me look at the table", not "dismiss forever".
        this.dialog.addEventListener('cancel', event => {
            event.preventDefault();
            this.peek();
        });
    }

    render(state) {
        this.state = state;
        if (state.phase !== 'finished' || !state.results) {
            this.peeking = false;
            this.close();
            return;
        }

        const { results, you, ready, players, hostId } = state;
        const won = results.winnerId === you;
        this.dialog.classList.toggle('is-loss', !won);
        $('#results-title').textContent = won ? 'You win!' : `${results.winnerName} wins`;
        $('#results-sub').textContent = results.reason === 'forfeit'
            ? 'Everyone else left the table.'
            : won ? 'Nicely played — that’s the last card.' : 'Better luck next round.';

        const present = new Set(players.map(p => p.id));
        $('#standings').replaceChildren(...results.standings.filter(s => present.has(s.id)).map((row, index) => {
            const isReady = ready.includes(row.id);
            const player = players.find(p => p.id === row.id) ?? row;
            return h('li', { class: `standing${row.id === results.winnerId ? ' is-winner' : ''}` },
                h('span', { class: 'standing-rank' }, row.id === results.winnerId ? icon('i-crown') : ordinal(index + 1)),
                avatar(player),
                h('span', { class: 'standing-name' }, row.id === you ? `${row.name} (you)` : row.name),
                h('span', { class: 'standing-meta' },
                    row.id === results.winnerId
                        ? h('span', {}, 'Winner')
                        : [h('span', {}, `${row.cardCount} ${row.cardCount === 1 ? 'card' : 'cards'}`), h('span', {}, `${row.points} pts`)]
                ),
                h('span', { class: `standing-ready${isReady ? ' is-ready' : ''}`, title: isReady ? 'Ready' : 'Not ready yet' }, icon('i-check'))
            );
        }));

        const waiting = players.filter(p => !ready.includes(p.id));
        const iAmReady = ready.includes(you);
        $('#ready-status').textContent = players.length < 2
            ? 'Everyone else has left. Head back to the lobby to invite more players.'
            : iAmReady
                ? `Waiting for ${listNames(waiting)}…`
                : `${ready.length} of ${players.length} ready for another round`;

        this.readyBtn.textContent = iAmReady ? 'Not ready' : 'Play again';
        this.readyBtn.classList.toggle('btn-primary', !iAmReady);
        this.readyBtn.classList.toggle('btn-secondary', iAmReady);
        this.readyBtn.disabled = players.length < 2;
        $('#results-lobby').hidden = hostId !== you;

        if (!this.peeking) this.open();
        this.reopenBtn.hidden = !this.peeking;
    }

    open() {
        this.reopenBtn.hidden = true;
        if (!this.dialog.open) {
            // Let the final card land before covering the table.
            clearTimeout(this.openTimer);
            this.openTimer = setTimeout(() => {
                if (this.state?.phase !== 'finished' || this.peeking || this.dialog.open) return;
                this.dialog.showModal();
                // Celebrate once per win, inside the dialog so it renders above the backdrop.
                const { results, you } = this.state;
                const gameKey = `${results.winnerId}:${this.state.log.at(-1)?.seq}`;
                if (results.winnerId === you && this.celebrated !== gameKey) {
                    this.celebrated = gameKey;
                    confetti(90, this.dialog);
                }
            }, 700);
        }
    }

    peek() {
        this.peeking = true;
        this.dialog.close();
        this.reopenBtn.hidden = false;
    }

    close() {
        clearTimeout(this.openTimer);
        if (this.dialog.open) this.dialog.close();
        this.reopenBtn.hidden = true;
    }
}

function listNames(players) {
    const names = players.map(p => p.name);
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
