import { $, h } from '../lib/dom.js';

const MAX_TOASTS = 3;

export function toast(message, type = 'info', duration = 3200) {
    const container = $('#toasts');
    const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
    container.append(el);

    while (container.children.length > MAX_TOASTS) container.firstElementChild.remove();

    setTimeout(() => {
        el.classList.add('is-leaving');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
}
