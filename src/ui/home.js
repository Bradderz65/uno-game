import { $, h, icon } from '../lib/dom.js';
import { getShareUrl, isLocalOnly } from '../lib/invite.js';
import { prefs } from '../lib/storage.js';
import { renderCard } from './cards.js';
import { enableBackdropClose } from './dialogs.js';
import { styledQrSvg } from './qr.js';
import { toast } from './toast.js';

const ROOM_POLL_MS = 3000;

const HERO_CARDS = [
    { id: 'h1', color: 'blue', type: 'reverse', value: 'reverse', r: -22, y: '6px', d: '0s' },
    { id: 'h2', color: 'green', type: 'number', value: 7, r: -8, y: '-6px', d: '-1.5s' },
    { id: 'h3', color: 'wild', type: 'wild_draw_four', value: '+4', r: 6, y: '-8px', d: '-3s' },
    { id: 'h4', color: 'red', type: 'number', value: 1, r: 20, y: '4px', d: '-4.5s' }
];

export class HomeScreen {
    constructor(app) {
        this.app = app;
        this.el = $('#home-screen');
        this.nameInput = $('#player-name');
        this.codeInput = $('#room-code');
        this.createBtn = $('#create-btn');
        this.joinBtn = $('#join-btn');
        this.roomsList = $('#rooms-list');
        this.pollTimer = null;
        this.busy = false;

        this.renderHeroCards();
        this.nameInput.value = prefs.get('name', '');

        const invited = new URLSearchParams(location.search).get('room');
        if (invited) this.codeInput.value = invited.trim().toUpperCase().slice(0, 4);

        this.createBtn.addEventListener('click', () => this.create());
        $('#join-form').addEventListener('submit', () => this.join(this.codeInput.value));
        $('#name-form').addEventListener('submit', () => {
            if (this.codeInput.value.trim().length === 4) this.join(this.codeInput.value);
            else this.create();
        });
        this.codeInput.addEventListener('input', () => {
            this.codeInput.value = this.codeInput.value.replace(/[^a-z]/gi, '').toUpperCase();
            this.codeInput.classList.remove('is-invalid');
        });
        this.nameInput.addEventListener('input', () => this.nameInput.classList.remove('is-invalid'));

        this.shareUrl = null;
        enableBackdropClose($('#qr-dialog'));
        $('#share-qr').addEventListener('click', () => this.shareUrl && $('#qr-dialog').showModal());
        $('#share-copy-btn').addEventListener('click', () => this.copyShareUrl());
    }

    renderHeroCards() {
        const container = $('#hero-cards');
        container.replaceChildren(...HERO_CARDS.map(({ r, y, d, ...card }) => {
            const el = renderCard(card);
            el.style.setProperty('--r', `${r}deg`);
            el.style.setProperty('--y', y);
            el.style.setProperty('--d', d);
            return el;
        }));
    }

    show() {
        this.el.hidden = false;
        this.renderShare();
        this.refreshRooms();
        clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => this.refreshRooms(), ROOM_POLL_MS);
        const focusTarget = this.nameInput.value ? (this.codeInput.value ? this.joinBtn : this.createBtn) : this.nameInput;
        requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
    }

    hide() {
        this.el.hidden = true;
        clearInterval(this.pollTimer);
        this.pollTimer = null;
    }

    readName() {
        const name = this.nameInput.value.trim().replace(/\s+/g, ' ');
        if (!name) {
            this.nameInput.classList.add('is-invalid');
            this.nameInput.focus();
            toast('Enter a name first', 'warning');
            return null;
        }
        prefs.set('name', name);
        return name;
    }

    async create() {
        const name = this.readName();
        if (!name || this.busy) return;
        await this.withBusy(this.createBtn, () => this.app.createRoom(name));
    }

    async join(rawCode) {
        const code = String(rawCode).trim().toUpperCase();
        if (code.length !== 4) {
            this.codeInput.classList.add('is-invalid');
            this.codeInput.focus();
            toast('Room codes are 4 letters', 'warning');
            return;
        }
        const name = this.readName();
        if (!name || this.busy) return;
        await this.withBusy(this.joinBtn, () => this.app.joinRoom(code, name));
    }

    async withBusy(button, task) {
        this.busy = true;
        button.disabled = true;
        try {
            await task();
        } finally {
            this.busy = false;
            button.disabled = false;
        }
    }

    /** Fill the "scan to join" card with a QR code for this server's network address. */
    async renderShare() {
        if (this.shareUrl) return;
        const url = await getShareUrl();
        this.shareUrl = url;
        const display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

        $('#share-url').textContent = display;
        $('#qr-large-url').textContent = display;
        if (isLocalOnly(url)) {
            $('#share-card').classList.add('is-offline');
            $('#share-text').textContent = 'Connect this device to Wi-Fi so others can scan in.';
        }

        try {
            const svg = styledQrSvg(url, { label: `QR code for ${display}` });
            $('#share-qr-code').innerHTML = svg;
            $('#qr-large').innerHTML = svg;
        } catch {
            $('#share-qr-code').textContent = 'QR unavailable';
        }
    }

    async copyShareUrl() {
        if (!this.shareUrl) return;
        try {
            await navigator.clipboard.writeText(this.shareUrl);
            toast('Link copied', 'success', 1800);
        } catch {
            // The clipboard API needs a secure context, which a LAN address isn't; fall back to selecting it.
            getSelection().selectAllChildren($('#share-url'));
            toast('Press Ctrl+C to copy', 'info');
        }
    }

    async refreshRooms() {
        const response = await this.app.request('rooms:list');
        if (this.el.hidden || !response.rooms) return;
        this.renderRooms(response.rooms);
    }

    renderRooms(rooms) {
        // Only show the list when there's something to join; an empty box is just noise.
        $('#rooms').hidden = !rooms.length;
        if (!rooms.length) {
            this.roomsList.replaceChildren();
            delete this.roomsList.dataset.key;
            return;
        }

        const key = JSON.stringify(rooms);
        if (this.roomsList.dataset.key === key) return;
        this.roomsList.dataset.key = key;

        this.roomsList.replaceChildren(...rooms.map(room => h('li', { class: 'room-row' },
            h('span', { class: 'room-row-code' }, room.code),
            h('span', { class: 'room-row-meta' },
                h('span', { class: 'room-row-host' }, `${room.host}’s room`),
                h('span', { class: 'room-row-count' }, `${room.playerCount} of ${room.maxPlayers} players`)
            ),
            h('button', {
                class: 'btn btn-secondary btn-sm',
                type: 'button',
                'aria-label': `Join room ${room.code}`,
                onclick: () => this.join(room.code)
            }, 'Join', icon('i-play'))
        )));
    }
}
