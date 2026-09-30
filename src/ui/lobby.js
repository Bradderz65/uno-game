import { LIMITS } from '../../shared/rules.js';
import { $, $$, h, icon, avatar } from '../lib/dom.js';
import { createQrSvg } from '../qr-code.js';
import { confirmDialog } from './dialogs.js';
import { toast } from './toast.js';

const SETTINGS_DEBOUNCE_MS = 250;

export class LobbyScreen {
    constructor(app) {
        this.app = app;
        this.el = $('#lobby-screen');
        this.state = null;
        this.inviteFor = null;
        this.pendingSettings = null;
        this.settingsTimer = null;

        $('#lobby-leave-btn').addEventListener('click', () => this.app.leaveRoom());
        $('#lobby-code').addEventListener('click', () => this.copy(this.state?.code, 'Room code copied'));
        $('#copy-invite-btn').addEventListener('click', () => this.copy($('#invite-url').value, 'Invite link copied'));
        $('#add-bot-btn').addEventListener('click', () => this.app.action('room:addBot'));
        $('#start-btn').addEventListener('click', () => this.app.action('room:start'));

        const shareBtn = $('#share-invite-btn');
        if (navigator.share) {
            shareBtn.hidden = false;
            shareBtn.addEventListener('click', () => {
                navigator.share({ title: 'Join my UNO game', text: `Room ${this.state?.code}`, url: $('#invite-url').value }).catch(() => {});
            });
        }

        for (const stepper of $$('.stepper', this.el)) {
            stepper.addEventListener('click', event => {
                const button = event.target.closest('[data-step]');
                if (!button) return;
                this.stepSetting(stepper, Number(button.dataset.step));
            });
        }

        $('#custom-enabled').addEventListener('change', event => {
            this.changeSettings({ customCard: { enabled: event.target.checked } });
        });
    }

    show() {
        this.el.hidden = false;
    }

    hide() {
        this.el.hidden = true;
    }

    get isHost() {
        return this.state && this.state.hostId === this.state.you;
    }

    render(state) {
        this.state = state;
        $('#lobby-code').textContent = state.code;
        this.renderPlayers(state);
        this.renderSettings(state.settings);
        this.renderFooter(state);
        this.renderInvite(state.code);
    }

    renderPlayers(state) {
        const list = $('#lobby-players');
        const isHost = this.isHost;
        const rows = state.players.map(player => {
            const badges = [];
            if (player.id === state.you) badges.push(h('span', { class: 'badge badge-you' }, 'You'));
            if (player.id === state.hostId) badges.push(h('span', { class: 'badge badge-host' }, icon('i-crown'), 'Host'));
            if (player.isBot) badges.push(h('span', { class: 'badge' }, 'Bot'));
            if (!player.connected) badges.push(h('span', { class: 'badge badge-offline' }, 'Reconnecting'));

            const canKick = isHost && player.id !== state.you;
            return h('li', { class: 'player-row', dataset: { playerId: player.id } },
                avatar(player),
                h('span', { class: 'player-row-name' }, player.name),
                h('span', { class: 'player-row-badges' }, badges),
                canKick && h('button', {
                    class: 'btn btn-ghost btn-icon btn-sm kick-btn',
                    type: 'button',
                    title: `Remove ${player.name}`,
                    'aria-label': `Remove ${player.name}`,
                    onclick: () => this.kick(player)
                }, icon('i-x'))
            );
        });

        if (state.players.length < LIMITS.minPlayers) {
            rows.push(h('li', { class: 'player-slot' }, 'Waiting for another player…'));
        }

        // Keep existing rows (and their entrance animation) when nothing changed.
        const key = JSON.stringify([state.players, state.hostId, isHost]);
        if (list.dataset.key !== key) {
            list.dataset.key = key;
            const previousIds = new Set($$('.player-row', list).map(row => row.dataset.playerId));
            list.replaceChildren(...rows);
            for (const row of $$('.player-row', list)) {
                if (previousIds.has(row.dataset.playerId)) row.style.animation = 'none';
            }
        }

        $('#lobby-count').textContent = `${state.players.length} / ${LIMITS.maxPlayers}`;
        const addBot = $('#add-bot-btn');
        addBot.hidden = !isHost;
        addBot.disabled = state.players.length >= LIMITS.maxPlayers;
    }

    renderSettings(settings) {
        const effective = this.pendingSettings ?? settings;
        const editable = this.isHost;

        for (const stepper of $$('.stepper', this.el)) {
            const value = readPath(effective, stepper.dataset.setting);
            stepper.querySelector('.stepper-value').textContent = value;
            stepper.classList.toggle('is-readonly', !editable);
            const [dec, inc] = stepper.querySelectorAll('.stepper-btn');
            dec.disabled = value <= Number(stepper.dataset.min);
            inc.disabled = value >= Number(stepper.dataset.max);
        }

        const toggle = $('#custom-enabled');
        toggle.checked = effective.customCard.enabled;
        toggle.disabled = !editable;
        $('#custom-settings').classList.toggle('is-collapsed', !effective.customCard.enabled);
        $('#settings-lock').hidden = editable;
    }

    renderFooter(state) {
        const hint = $('#lobby-hint');
        const start = $('#start-btn');
        const enough = state.players.length >= LIMITS.minPlayers;

        start.hidden = !this.isHost;
        start.disabled = !enough;

        if (this.isHost) {
            hint.hidden = enough;
            hint.textContent = 'Invite a friend or add a bot to start.';
        } else {
            hint.hidden = false;
            const host = state.players.find(p => p.id === state.hostId);
            hint.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), `Waiting for ${host?.name ?? 'the host'} to start…`);
        }
    }

    async renderInvite(code) {
        if (this.inviteFor === code) return;
        this.inviteFor = code;
        const url = await getInviteUrl(code);
        $('#invite-url').value = url;
        try {
            $('#invite-qr').innerHTML = createQrSvg(url);
        } catch {
            $('#invite-qr').textContent = 'QR unavailable';
        }
    }

    stepSetting(stepper, delta) {
        if (!this.isHost) return;
        const path = stepper.dataset.setting;
        const base = this.pendingSettings ?? this.state.settings;
        const current = readPath(base, path);
        const next = Math.min(Number(stepper.dataset.max), Math.max(Number(stepper.dataset.min), current + delta));
        if (next === current) return;
        this.changeSettings(writePath({}, path, next));
    }

    /** Apply optimistically, then send to the server after a short pause. */
    changeSettings(patch) {
        const base = this.pendingSettings ?? this.state.settings;
        this.pendingSettings = {
            ...base,
            ...patch,
            customCard: { ...base.customCard, ...patch.customCard }
        };
        this.renderSettings(this.state.settings);

        clearTimeout(this.settingsTimer);
        this.settingsTimer = setTimeout(async () => {
            const settings = this.pendingSettings;
            const result = await this.app.action('room:settings', { settings });
            if (this.pendingSettings === settings) this.pendingSettings = null;
            if (result.error && this.state) this.renderSettings(this.state.settings);
        }, SETTINGS_DEBOUNCE_MS);
    }

    async kick(player) {
        const confirmed = await confirmDialog({
            title: `Remove ${player.name}?`,
            text: player.isBot ? 'The bot will leave the room.' : 'They won’t be able to rejoin this room.',
            confirmLabel: 'Remove'
        });
        if (confirmed) this.app.action('room:kick', { playerId: player.id });
    }

    async copy(text, message) {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            toast(message, 'success', 1800);
        } catch {
            $('#invite-url').select();
            toast('Press Ctrl+C to copy', 'info');
        }
    }
}

function readPath(obj, path) {
    return path.split('.').reduce((value, key) => value?.[key], obj);
}

function writePath(obj, path, value) {
    const keys = path.split('.');
    let target = obj;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
    return obj;
}

async function getInviteUrl(code) {
    const fallback = new URL(location.href);
    fallback.search = '';
    fallback.hash = '';
    fallback.searchParams.set('room', code);

    // On localhost the page URL is useless to other devices, so ask the server for its LAN address.
    if (!['localhost', '127.0.0.1', '::1'].includes(location.hostname)) return fallback.toString();
    try {
        const response = await fetch('/api/network-url');
        if (!response.ok) throw new Error(String(response.status));
        const { url } = await response.json();
        const networkUrl = new URL(url);
        if (location.port && location.port !== networkUrl.port) networkUrl.port = location.port;
        networkUrl.searchParams.set('room', code);
        return networkUrl.toString();
    } catch {
        return fallback.toString();
    }
}
